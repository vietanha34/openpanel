import type { IEventAnalyticsPeriod } from '@openpanel/validation';

/**
 * Every date the comparison UI computes or prints goes through here.
 *
 * The requirements name the bug this exists to prevent: doing the arithmetic on
 * the day number of a formatted string turned "Sep 15 minus 21 days" into
 * "-6 Sep". Shifting is `Date.setDate()` only, and labels are formatted from a
 * `Date`, never from slicing another label.
 */

const MONTH_NAMES = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];

/** A copy of `date` moved by `days`. Never mutates the argument. */
export function shiftDays(date: Date, days: number): Date {
  const shifted = new Date(date.getTime());
  shifted.setDate(shifted.getDate() + days);
  return shifted;
}

function pad2(value: number): string {
  return value < 10 ? `0${value}` : String(value);
}

function clickhouseDate(date: Date, endOfDay: boolean): string {
  const day = `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
  return `${day} ${endOfDay ? '23:59:59' : '00:00:00'}`;
}

/**
 * The comparison periods, baseline first, each stepping back `days` from the
 * one before. Every period is the same length by construction — invariant I10,
 * which the contract enforces again on the server.
 */
export function periodsFrom(
  anchorStart: Date,
  days: number,
  count: number,
): IEventAnalyticsPeriod[] {
  const periods: IEventAnalyticsPeriod[] = [];

  for (let index = 0; index < count; index++) {
    const start = shiftDays(anchorStart, -days * index);
    periods.push({
      startDate: clickhouseDate(start, false),
      endDate: clickhouseDate(shiftDays(start, days - 1), true),
    });
  }

  return periods;
}

/**
 * Chart axis tick: `05.09`, or `14:00` on the hourly grain, where every bucket
 * of a day would otherwise read as the same date.
 */
export function axisLabel(date: Date, grain?: 'hour' | 'day' | 'week'): string {
  if (grain === 'hour') {
    return `${pad2(date.getHours())}:00`;
  }
  return `${pad2(date.getDate())}.${pad2(date.getMonth() + 1)}`;
}

/** Tooltip header and crosshair footer: `5 Sep 2026`. */
export function longDate(date: Date): string {
  return `${date.getDate()} ${MONTH_NAMES[date.getMonth()]} ${date.getFullYear()}`;
}

/** Period chip and table footer: `Sep 12 — 18`, or `Aug 29 — Sep 4` across a month. */
export function periodRange(start: Date, days: number): string {
  const end = shiftDays(start, days - 1);
  const startMonth = MONTH_NAMES[start.getMonth()];
  const endMonth = MONTH_NAMES[end.getMonth()];
  const endLabel =
    startMonth === endMonth
      ? String(end.getDate())
      : `${endMonth} ${end.getDate()}`;

  return `${startMonth} ${start.getDate()} — ${endLabel}`;
}

/**
 * Relative change against the baseline, in percent, or `null` when there is no
 * baseline to divide by.
 *
 * `null` renders as `—`. The design computes `0.00 %` in this case; the
 * requirements ask for `—`, and they are right: `0.00 %` claims "unchanged"
 * when the truth is "nothing to compare against" (Phase 3 spec A3).
 */
export function deltaPercent(value: number, baseline: number): number | null {
  if (baseline === 0) {
    return null;
  }
  return (value / baseline - 1) * 100;
}
