# Data infrastructure

FIAP X uses `mysql2` directly and does not use an ORM. Three logical databases share one MySQL
8 server, but each service connects only to the database it owns. UUIDs are stored as canonical
36-character strings. There are no cross-database foreign keys.

| Owner                | Database          | Tables          |
| -------------------- | ----------------- | --------------- |
| Auth Service         | `auth_db`         | `users`         |
| Video Service        | `video_db`        | `videos`        |
| Notification Service | `notification_db` | `notifications` |

The Processor Service is stateless at this stage. Its durable work queue remains in RabbitMQ,
while video processing state belongs to the Video Service.

## Migrations

The bootstrap migration creates the three databases. Each database then has an independent,
ordered directory under `infra/mysql/migrations`. The TypeScript runner creates and uses a
`schema_migrations` bookkeeping table in each database, computes SHA-256 checksums, and serializes
execution with a MySQL advisory lock. SQL migrations must remain idempotent because MySQL DDL can
cause implicit commits.

Run migrations from the repository root:

```sh
cp .env.example .env
npm run db:migrate
```

The configured MySQL user needs permission to create the three databases and their tables. The
runner enables multiple statements only on its short-lived administrative connections;
application pools do not enable them.

The `video_db` migrations store the latest processing error code and message directly on the
video row. `error_code` is nullable and constrained to `FFMPEG_ERROR` or `ZIP_ERROR`; it is
cleared when a new attempt starts or completes. No event history or event-sourcing tables are
created.

## Local seeds

`npm run db:seed` inserts John Doe and Mary Doe into `auth_db.users`. The seed checks usernames
before insertion, so subsequent runs do not modify existing users. Passwords are hashed at seed
time with `bcryptjs` and 12 rounds; plaintext passwords are never written to MySQL.

These accounts are for local demonstrations only. Their documented credentials are in the root
README.

## Runtime values

The migration and seed commands read `.env` when it exists. `MYSQL_DATABASE` is ignored by these
commands: migrations target all three databases, while seeds explicitly target `auth_db`.
Application services select only the database they own. In particular, the Auth Service fixes
its runtime database to `auth_db` instead of accepting a database name from the environment.

- `MYSQL_HOST`, `MYSQL_PORT`, `MYSQL_USERNAME`, `MYSQL_PASSWORD`
- `MYSQL_DATABASE`, `MYSQL_CONNECTION_LIMIT`, `MYSQL_SSL`
- `REDIS_URL`
- `RABBITMQ_URL`
