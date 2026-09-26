# Pipeline de qualidade

O workflow `.github/workflows/ci.yml` executa em pull requests e pushes para `main`, com Node.js 24.15.0 e npm 11.12.1. Depois de `npm ci`, aplica em sequência os gates `format:check`, `lint`, `typecheck`, `test:coverage` e `build`. O relatório de cobertura é enviado como artifact por 7 dias quando existir, inclusive se os testes falharem.

## Inventário para a etapa 10.2

- Branch principal: `main`. O diretório fornecido não contém metadados `.git`; portanto, este nome foi inferido pela convenção do projeto e deve ser confirmado quando o repositório Git estiver disponível.
- Runtime: `engines.node` 24.15.0, `.node-version` e `.nvmrc` 24.15.0; `packageManager` fixa npm 11.12.1.
- Scripts raiz: `format:check`, `lint`, `typecheck`, `test:coverage` e `build` já são agregadores do monorepo.
- Workspaces: `apps/auth-service`, `apps/frontend`, `apps/notification-service`, `apps/processor-service`, `apps/video-service`, `packages/config`, `packages/contracts`, `packages/infrastructure`, `packages/observability` e `packages/test-utils`.
- Jest: cada workspace usa seu `jest.config.js`, baseado em `packages/config/jest/base.config.js`; `coverageThreshold.global` exige 80% em branches, functions, lines e statements.
- Dockerfiles existentes: `infra/docker/auth-service/Dockerfile`, `infra/docker/frontend/Dockerfile`, `infra/docker/notification-service/Dockerfile`, `infra/docker/processor-service/Dockerfile` e `infra/docker/video-service/Dockerfile`.
- Dependências externas: os testes unitários não recebem serviços de MySQL, Redis, RabbitMQ, FFmpeg ou Minikube no pipeline.

## Entrega de imagens versionadas

O workflow `.github/workflows/images.yml` constrói as cinco imagens em pull requests que alterem arquivos de build, sem login ou publicação. Um push de tag `v*` autentica no GHCR somente com `GITHUB_TOKEN`, verifica as imagens e publica duas tags imutáveis por componente: a versão Git, como `v1.2.3`, e `sha-<commit>`.

As imagens publicadas seguem estes nomes:

- `ghcr.io/<owner>/fiap-x-auth-service:<versao>`
- `ghcr.io/<owner>/fiap-x-video-service:<versao>`
- `ghcr.io/<owner>/fiap-x-processor-service:<versao>`
- `ghcr.io/<owner>/fiap-x-notification-service:<versao>`
- `ghcr.io/<owner>/fiap-x-frontend:<versao>`

O `infra/k8s/apps/kustomization.yaml` mantém `fiap-x/<componente>:local` como padrão para o build local da Fase 09. Para preparar manualmente uma versão publicada, substitua cada `newName` pelo nome GHCR correspondente e cada `newTag` pela tag explícita desejada. A política `IfNotPresent` usa a imagem local já carregada quando disponível ou permite obtê-la do registry. Pacotes GHCR privados também exigem que o usuário configure manualmente uma credencial de pull no cluster local.

O workflow não cria tags Git, não publica `latest`, não cria releases e não acessa nem implanta no Minikube.
