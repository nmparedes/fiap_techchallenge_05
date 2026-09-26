import type { ConfirmChannel } from 'amqplib';
import type { ProcessingRequestedEventV1 } from '@fiap-x/contracts';
import { VIDEO_EVENT_TOPOLOGY, publishVideoEvent } from '@fiap-x/infrastructure';

export interface ProcessingRequestPublisher {
  publish(event: ProcessingRequestedEventV1): Promise<void>;
  ping(): Promise<void>;
}

export class RabbitMqProcessingRequestPublisher implements ProcessingRequestPublisher {
  public constructor(private readonly channel: ConfirmChannel) {}

  public async publish(event: ProcessingRequestedEventV1): Promise<void> {
    await publishVideoEvent(this.channel, event);
  }

  public async ping(): Promise<void> {
    await this.channel.checkExchange(VIDEO_EVENT_TOPOLOGY.exchanges.events);
  }
}
