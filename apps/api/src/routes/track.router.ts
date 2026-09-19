import {
  MAX_TRACK_BATCH_SIZE,
  zTrackHandlerPayload,
} from '@openpanel/validation';
import type { FastifyPluginAsyncZodOpenApi } from 'fastify-zod-openapi';
import { z } from 'zod';
import {
  fetchDeviceId,
  handler,
  handlerBatch,
} from '@/controllers/track.controller';
import { clientHook } from '@/hooks/client.hook';
import { duplicateHook } from '@/hooks/duplicate.hook';
import { isBotHook } from '@/hooks/is-bot.hook';
import { subscriptionHook } from '@/hooks/subscription.hook';

const trackRouter: FastifyPluginAsyncZodOpenApi = async (fastify) => {
  fastify.addHook('preValidation', duplicateHook);
  fastify.addHook('preHandler', clientHook);
  fastify.addHook('preHandler', isBotHook);
  fastify.addHook('preHandler', subscriptionHook);

  await fastify.route({
    method: 'POST',
    url: '/',
    schema: {
      body: zTrackHandlerPayload.and(
        z.object({
          clientId: z.string().optional(),
          clientSecret: z.string().optional(),
        })
      ),
      tags: ['Track'],
      description:
        'Ingest a tracking event (track, identify, group, increment, decrement, replay).',
      response: {
        200: z.object({
          deviceId: z.string(),
          sessionId: z.string(),
        }),
      },
    },
    handler,
  });

  await fastify.route({
    method: 'POST',
    url: '/batch',
    schema: {
      // Items are validated one at a time inside the handler so one malformed
      // event is reported by index instead of rejecting the whole batch — hence
      // `unknown` here rather than an array of zTrackBatchItem.
      body: z.array(z.unknown()).min(1).max(MAX_TRACK_BATCH_SIZE),
      tags: ['Track'],
      description:
        'Ingest many track events from one visitor in a single request. Each event keeps its own `properties.__timestamp`; the request time is only the fallback for events without one.',
      response: {
        200: z.object({
          deviceId: z.string(),
          sessionId: z.string(),
          accepted: z.number(),
          failed: z.array(
            z.object({ index: z.number(), error: z.string() })
          ),
        }),
      },
    },
    handler: handlerBatch,
  });

  await fastify.route({
    method: 'GET',
    url: '/device-id',
    schema: {
      tags: ['Track'],
      description:
        'Get or generate a stable device ID and session ID for the current visitor.',
      response: {
        200: z.object({
          deviceId: z.string(),
          sessionId: z.string(),
          message: z.string().optional(),
        }),
      },
    },
    handler: fetchDeviceId,
  });
};

export default trackRouter;
