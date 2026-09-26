# RabbitMQ topology

FIAP X declares one durable topic exchange, `video.events`. Resource names and routing keys are
centralized in `VIDEO_EVENT_TOPOLOGY` from `@fiap-x/infrastructure`.

| Queue                                            | Consumer             | Bindings                                                                            |
| ------------------------------------------------ | -------------------- | ----------------------------------------------------------------------------------- |
| `video.processing.requests.processor`            | Processor Service    | `video.processing.requested`                                                        |
| `video.processing.status.video-service`          | Video Service        | `video.processing.started`, `video.processing.completed`, `video.processing.failed` |
| `video.processing.failures.notification-service` | Notification Service | `video.processing.failed`                                                           |
| `video.events.dead-letter`                       | Operations/recovery  | `#` from the `video.events.dead-letter` dead-letter exchange                        |

All exchanges and queues are durable. Queues use the RabbitMQ quorum queue type. Every service
queue declares `video.events.dead-letter` as its dead-letter exchange; the shared dead-letter
queue binds every dead-letter routing key.

## Publishing

`publishVideoEvent` accepts the versioned processing-event union from `packages/contracts`, sends
JSON with persistent delivery mode, and includes the event identifier, event type, and timestamp
as AMQP metadata. It respects channel backpressure and waits for a publisher confirm before
returning. Callers must use an `amqplib` `ConfirmChannel`.

## Consumption and acknowledgements

The three consumer helpers use the matching shared TypeBox schema and configure `noAck: false`.
The Processor Service helper defaults to prefetch `1`; every helper accepts a positive integer
`prefetch` override.

- Valid JSON that matches the queue contract is acknowledged only after its handler completes.
- Invalid content type, malformed JSON, and schema-invalid events are negatively acknowledged
  with `requeue=false`, which sends them to the dead-letter queue. The Video Service counts and
  logs this outcome without logging message content.
- Handler errors also dead-letter by default. A service may set `requeueOnHandlerError=true` for a
  known transient failure; RabbitMQ then redelivers the message.
- If a channel or consumer closes before acknowledgement, RabbitMQ automatically makes the
  unacknowledged delivery available again and marks a later delivery as redelivered.

Handlers must be idempotent because manual acknowledgements and connection failures provide
at-least-once delivery, not exactly-once processing. Operational tooling should inspect the
dead-letter queue before replaying messages.

The Video Service additionally guards every update by video UUID, user UUID, attempt, and current
state. `started` permits only `QUEUED` to `PROCESSING`; `completed` and `failed` permit only
`PROCESSING` to their terminal state. A zero-row update identifies a duplicate, stale, or
out-of-order event: it is logged, counted, and safely acknowledged without cache invalidation.
Successful updates invalidate the owning user's detail and listing caches before acknowledgement.
Database failures are logged without connection details and rethrown, so the consumer negatively
acknowledges them instead of acknowledging unpersisted state.
