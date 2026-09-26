import type { Channel, ConsumeMessage, Replies } from 'amqplib';
import { consumeProcessingRequests } from '@fiap-x/infrastructure';

import type { ProcessingEventHandler } from './processing-event-handler.js';

export interface StartProcessorWorkerOptions {
  channel: Channel;
  handler: Pick<ProcessingEventHandler, 'handle'>;
  prefetch: number;
  onInvalidMessage?: (message: ConsumeMessage) => void;
}

export interface ProcessorWorker {
  stopAccepting(): Promise<void>;
  waitForIdle(): Promise<void>;
}

export async function startProcessorWorker(
  options: StartProcessorWorkerOptions,
): Promise<ProcessorWorker> {
  const activeJobs = new Set<Promise<void>>();
  const registration: Replies.Consume = await consumeProcessingRequests(
    options.channel,
    async (event) => {
      const job = options.handler.handle(event);
      activeJobs.add(job);
      try {
        await job;
      } finally {
        activeJobs.delete(job);
      }
    },
    {
      prefetch: options.prefetch,
      requeueOnHandlerError: true,
      ...(options.onInvalidMessage === undefined
        ? {}
        : { onInvalidMessage: options.onInvalidMessage }),
    },
  );

  return {
    stopAccepting: async () => {
      await options.channel.cancel(registration.consumerTag);
    },
    waitForIdle: async () => {
      await Promise.allSettled([...activeJobs]);
    },
  };
}
