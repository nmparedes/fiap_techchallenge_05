import type { Channel, ConsumeMessage, Replies } from 'amqplib';
import { consumeProcessingFailures } from '@fiap-x/infrastructure';

import type { FailureNotificationHandler } from './failure-notification-handler.js';

export interface StartNotificationWorkerOptions {
  channel: Channel;
  handler: Pick<FailureNotificationHandler, 'handle'>;
  onInvalidMessage?: (message: ConsumeMessage) => void;
}

export interface NotificationWorker {
  stopAccepting(): Promise<void>;
  waitForIdle(): Promise<void>;
}

export async function startNotificationWorker(
  options: StartNotificationWorkerOptions,
): Promise<NotificationWorker> {
  const activeJobs = new Set<Promise<void>>();
  const registration: Replies.Consume = await consumeProcessingFailures(
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
      prefetch: 1,
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
