# Authentication

## Scope

The Auth Service provides the minimum authentication boundary required by FIAP X:

1. A pre-provisioned user submits a username and password.
2. The service loads the user from the owned `auth_db.users` table.
3. The supplied password is compared with the stored bcrypt hash.
4. A valid login receives a short-lived HS256 JWT.
5. APIs accept the JWT through the standard `Authorization: Bearer <token>` header.

The service does not expose registration, refresh tokens, password recovery, MFA, RBAC,
server-side logout, or server-side JWT sessions. Local demonstration users are provisioned only
through `npm run db:seed`.

## HTTP API

### Login

`POST /auth/login`

```json
{
  "username": "john.doe",
  "password": "JohnDoe123!"
}
```

A successful response has this shape:

```json
{
  "success": true,
  "data": {
    "accessToken": "<signed-jwt>",
    "tokenType": "Bearer",
    "expiresIn": 3600,
    "user": {
      "id": "<uuid>",
      "username": "john.doe",
      "displayName": "John Doe"
    }
  }
}
```

Unknown usernames and incorrect passwords both return the same `401 INVALID_CREDENTIALS`
response. This avoids exposing whether an account exists. The service also performs a bcrypt
comparison against a fixed dummy hash for unknown usernames to reduce timing differences.

The API uses the same error envelope for every failure category:

| HTTP status | Code                  | Condition                              |
| ----------- | --------------------- | -------------------------------------- |
| `400`       | `INVALID_REQUEST`     | The request payload does not validate. |
| `401`       | `INVALID_CREDENTIALS` | The username or password is invalid.   |
| `503`       | `SERVICE_UNAVAILABLE` | MySQL cannot serve the request.        |
| `500`       | `INTERNAL_ERROR`      | An unexpected internal error occurs.   |

The token uses HS256 and contains only the authenticated user UUID in `sub`, the username, the
configured issuer and audience, and standard issued-at and expiration claims. The default token
lifetime is one hour. API consumers must validate the signature, algorithm, issuer, audience,
and expiration before trusting these claims.

Backend consumers use `createAuthTokenVerifier` from `@fiap-x/infrastructure`. The shared helper
accepts only HS256 tokens with the configured issuer and audience, checks all required claims,
and rejects malformed, expired, incorrectly signed, or structurally invalid tokens with the
same sanitized `InvalidAuthTokenError`.

## Configuration

| Variable                      | Required | Default               | Constraint              |
| ----------------------------- | -------- | --------------------- | ----------------------- |
| `AUTH_JWT_SECRET`             | Yes      | -                     | At least 32 UTF-8 bytes |
| `AUTH_HOST`                   | No       | `0.0.0.0`             | Non-empty string        |
| `AUTH_PORT`                   | No       | `3001`                | 1 to 65535              |
| `AUTH_JWT_EXPIRES_IN_SECONDS` | No       | `3600`                | 60 to 86400             |
| `AUTH_JWT_ISSUER`             | No       | `fiap-x-auth-service` | Non-empty string        |
| `AUTH_JWT_AUDIENCE`           | No       | `fiap-x-api`          | Non-empty string        |

The service uses the shared `MYSQL_*` connection variables but always selects `auth_db` so that
database ownership cannot be changed accidentally through `MYSQL_DATABASE`.

## Operations and security

- Passwords, password hashes, and tokens are absent from both API errors and structured logs.
- Authentication events are JSON logs containing an event name and, only on success, the user
  identifier. Every request log and response carries the generated `x-request-id` correlation
  value.
- `GET /metrics` exposes login outcomes and HTTP duration histograms in Prometheus format.
- `GET /health/live` reports process liveness without checking external dependencies.
- `GET /health/ready` checks only the required MySQL connection.
- Swagger UI is available at `GET /docs`; the OpenAPI document describes every public route,
  response envelope, and the JWT Bearer format. Health and metrics explicitly have no security
  requirement.
- JWT revocation is intentionally not implemented. Tokens remain valid until their short
  expiration time, so the secret must be rotated if signing material is compromised.
