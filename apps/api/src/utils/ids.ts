import crypto from 'node:crypto';
import { generateDeviceId } from '@openpanel/common/server';
import {
  convertClickhouseDateToJs,
  SESSION_TIMEOUT_MS,
  sessionBuffer,
} from '@openpanel/db';
import type { IClickhouseSession } from '@openpanel/db';

interface DeviceIdentity {
  projectId: string;
  ip: string;
  ua: string | undefined;
  salts: { current: string; previous: string };
  overrideDeviceId?: string;
}

/**
 * Candidate device ids in priority order. A caller-supplied id is stable (no
 * salt rotation), so it's the only candidate; otherwise both salt windows are.
 * Empty when there is nothing to hash and no override.
 */
function getCandidateDeviceIds({
  projectId,
  ip,
  ua,
  salts,
  overrideDeviceId,
}: DeviceIdentity): string[] {
  if (overrideDeviceId) {
    return [overrideDeviceId];
  }

  if (!ua) {
    return [];
  }

  return [
    generateDeviceId({ salt: salts.current, origin: projectId, ip, ua }),
    generateDeviceId({ salt: salts.previous, origin: projectId, ip, ua }),
  ];
}

export async function getDeviceId({
  eventTimeMs,
  ...identity
}: DeviceIdentity & {
  /** Event timestamp (ms). Used to decide whether an existing session is
   *  still within its idle window. Defaults to `Date.now()`. */
  eventTimeMs?: number;
}) {
  const candidates = [
    ...new Set(getCandidateDeviceIds(identity).filter(Boolean)),
  ];

  if (candidates.length === 0) {
    return { deviceId: '', sessionId: '' };
  }

  return resolveSession({
    projectId: identity.projectId,
    candidates,
    sessions: await fetchSessions(identity.projectId, candidates),
    eventTimeMs: eventTimeMs ?? Date.now(),
  });
}

/**
 * Batch counterpart of `getDeviceId`. All events belong to one visitor, so the
 * candidate ids and their session blobs are the same for the whole batch — read
 * them once, then resolve a session per event timestamp.
 *
 * `eventTimesMs` MUST be ascending. Consecutive events closer than the idle
 * window share a session id even when they straddle a bucket boundary: the
 * worker hasn't persisted a blob for the earlier events of this batch yet, so
 * the deterministic bucket id alone would split one visit in two.
 */
export async function getBatchDeviceIds({
  eventTimesMs,
  ...identity
}: DeviceIdentity & {
  eventTimesMs: number[];
}): Promise<DeviceIdResult[]> {
  const candidates = [
    ...new Set(getCandidateDeviceIds(identity).filter(Boolean)),
  ];

  if (candidates.length === 0) {
    return eventTimesMs.map(() => ({ deviceId: '', sessionId: '' }));
  }

  const sessions = await fetchSessions(identity.projectId, candidates);

  const results: DeviceIdResult[] = [];
  let previous: { sessionId: string; eventTimeMs: number } | undefined;

  for (const eventTimeMs of eventTimesMs) {
    const resolved = resolveSession({
      projectId: identity.projectId,
      candidates,
      sessions,
      eventTimeMs,
    });

    const continuesPreviousSession =
      previous && eventTimeMs - previous.eventTimeMs < SESSION_TIMEOUT_MS;

    const sessionId = continuesPreviousSession
      ? previous!.sessionId
      : resolved.sessionId;

    results.push({ deviceId: resolved.deviceId, sessionId });
    previous = { sessionId, eventTimeMs };
  }

  return results;
}

interface DeviceIdResult {
  deviceId: string;
  sessionId: string;
}

/**
 * Returns true when an existing session is recent enough that the incoming
 * event should EXTEND it rather than start a new session.
 *
 * Critical: blobs no longer have a Redis TTL (so the reaper can always find
 * them), which means an existing session blob may linger past its idle
 * window. We must NOT blindly reuse `existing.id` — if we did, the worker's
 * boundary detection would open a "new" session with the same id as the
 * closed one, breaking the id-based extension check in createSessionEnd.
 */
function withinIdleWindow(
  session: IClickhouseSession,
  eventTimeMs: number
): boolean {
  const lastEventMs = convertClickhouseDateToJs(session.ended_at).getTime();
  return eventTimeMs - lastEventMs < SESSION_TIMEOUT_MS;
}

/**
 * Reading the live blob is the source of truth for an active session — it's
 * what keeps a visit on one id across page reloads and salt rotation. Don't
 * drop this read to "save" a lookup or sessions split at the bucket boundary.
 *
 * Returns one entry per candidate, aligned by index; a read failure yields all
 * nulls so the caller falls back to the deterministic bucket id.
 */
async function fetchSessions(
  projectId: string,
  candidates: string[]
): Promise<(IClickhouseSession | null)[]> {
  try {
    return await Promise.all(
      candidates.map((deviceId) =>
        sessionBuffer.getExistingSession({ projectId, deviceId })
      )
    );
  } catch (error) {
    console.error('Error resolving session for device id', error);
    return candidates.map(() => null);
  }
}

function resolveSession({
  projectId,
  candidates,
  sessions,
  eventTimeMs,
}: {
  projectId: string;
  /** Candidate device ids in priority order (e.g. [current, previous] salt
   *  windows, or just [override]). Deduped; the first is canonical. */
  candidates: string[];
  sessions: (IClickhouseSession | null)[];
  eventTimeMs: number;
}): DeviceIdResult {
  const primary = candidates[0] ?? '';

  for (const [i, session] of sessions.entries()) {
    if (session && withinIdleWindow(session, eventTimeMs)) {
      return { deviceId: candidates[i]!, sessionId: session.id };
    }
  }

  return {
    deviceId: primary,
    // Deterministic id for the first event of a session and to bridge the window
    // before the worker persists the blob (API resolves synchronously, worker
    // writes async — same bucket → same id, so they agree).
    //
    // The bucket window MUST track the idle timeout: a gap > the window has to
    // land in a new bucket so a boundary mints a *fresh* id. If it didn't (e.g.
    // a hardcoded 30min while SESSION_TIMEOUT_MS is shorter), the worker would
    // reopen the just-closed id and its session_end would be skipped. Grace must
    // stay < window or getSessionId throws.
    sessionId: getSessionId({
      projectId,
      deviceId: primary,
      eventMs: eventTimeMs,
      graceMs: Math.min(5_000, Math.floor(SESSION_TIMEOUT_MS / 6)),
      windowMs: SESSION_TIMEOUT_MS,
    }),
  };
}

/**
 * Deterministic session id for (projectId, deviceId) within a time window,
 * with a grace period at the *start* of each window to avoid boundary splits.
 *
 * - windowMs: 30 minutes by default
 * - graceMs: 1 minute by default (events in first minute of a bucket map to previous bucket)
 * - Output: base64url, 128-bit (16 bytes) truncated from SHA-256
 */
function getSessionId(params: {
  projectId: string;
  deviceId: string;
  eventMs?: number; // use event timestamp; defaults to Date.now()
  windowMs?: number; // default 5 min
  graceMs?: number; // default 1 min
  bytes?: number; // default 16 (128-bit). You can set 24 or 32 for longer ids.
}): string {
  const {
    projectId,
    deviceId,
    eventMs = Date.now(),
    windowMs = 5 * 60 * 1000,
    graceMs = 60 * 1000,
    bytes = 16,
  } = params;

  if (!projectId) {
    throw new Error('projectId is required');
  }
  if (!deviceId) {
    throw new Error('deviceId is required');
  }
  if (windowMs <= 0) {
    throw new Error('windowMs must be > 0');
  }
  if (graceMs < 0 || graceMs >= windowMs) {
    throw new Error('graceMs must be >= 0 and < windowMs');
  }
  if (bytes < 8 || bytes > 32) {
    throw new Error('bytes must be between 8 and 32');
  }

  const bucket = Math.floor(eventMs / windowMs);
  const offset = eventMs - bucket * windowMs;

  // Grace at the start of the bucket: stick to the previous bucket.
  const chosenBucket = offset < graceMs ? bucket - 1 : bucket;

  const input = `sess:v1:${projectId}:${deviceId}:${chosenBucket}`;

  const digest = crypto.createHash('sha256').update(input).digest();
  const truncated = digest.subarray(0, bytes);

  // base64url
  return truncated
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}
