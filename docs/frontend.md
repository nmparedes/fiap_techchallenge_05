# Frontend

The frontend uses Vite, TypeScript, and native browser APIs. Configure the public API origins for
local development:

```dotenv
VITE_AUTH_API_BASE_URL=http://localhost:3001
VITE_VIDEO_API_BASE_URL=http://localhost:3002
VITE_NOTIFICATION_API_BASE_URL=http://localhost:3004
```

Each URL must be absolute and use HTTP or HTTPS. The Bearer token remains only in
`sessionStorage`; services identify the user from the token, and the frontend does not send a
`userId`.

Run these commands from the repository root:

```sh
npm run dev --workspace @fiap-x/frontend
npm run build --workspace @fiap-x/frontend
npm run lint --workspace @fiap-x/frontend
npm run typecheck --workspace @fiap-x/frontend
npm run test:coverage --workspace @fiap-x/frontend
```

The dashboard polls videos and notifications every three seconds while the session is active and
the page is visible. Uploads accept MP4, AVI, MOV, MKV, WMV, FLV, and WebM files up to 200 MiB with
an integer FPS from 1 to 10.

The production frontend uses same-origin `/auth`, `/videos`, and `/notifications` routes provided
by the Kubernetes Ingress.
