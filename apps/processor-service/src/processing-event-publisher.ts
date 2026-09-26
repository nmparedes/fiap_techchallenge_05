import type { ConfirmChannel } from 'amqplib';
import type { ProcessingStatusEventV1 } from '@fiap-x/contracts';
import { publishVideoEvent } from '@fiap-x/infrastructure';

export interface ProcessingStatusPublisher {
  publish(event: ProcessingStatusEventV1): Promise<void>;
}

export class RabbitMqProcessingStatusPublisher implements ProcessingStatusPublisher {
  public constructor(private readonly channel: ConfirmChannel) {}

  public async publish(event: ProcessingStatusEventV1): Promise<void> {
    await publishVideoEvent(this.channel, event);
  }
}
