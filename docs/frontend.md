# Frontend

O frontend usa Vite, TypeScript e APIs nativas do navegador. Configure as origens públicas antes de
iniciar:

```dotenv
VITE_AUTH_API_BASE_URL=http://localhost:3001
VITE_VIDEO_API_BASE_URL=http://localhost:3002
VITE_NOTIFICATION_API_BASE_URL=http://localhost:3004
```

As URLs devem ser absolutas e usar HTTP ou HTTPS. O token Bearer permanece somente em
`sessionStorage`; os serviços identificam o usuário pelo token e o frontend não envia `userId`.

Execute a partir da raiz do repositório:

```sh
npm run dev --workspace @fiap-x/frontend
npm run build --workspace @fiap-x/frontend
npm run lint --workspace @fiap-x/frontend
npm run typecheck --workspace @fiap-x/frontend
npm run test:coverage --workspace @fiap-x/frontend
```

O painel consulta vídeos e notificações a cada três segundos enquanto a sessão está ativa e a página
está visível. Uploads aceitam MP4, AVI, MOV, MKV, WMV, FLV e WebM, até 200 MiB, com FPS inteiro de
1 a 10.
