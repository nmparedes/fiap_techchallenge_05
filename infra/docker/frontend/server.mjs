import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, join, normalize } from 'node:path';

const host = process.env.FRONTEND_HOST ?? '0.0.0.0';
const port = Number.parseInt(process.env.FRONTEND_PORT ?? '8080', 10);
const staticRoot = join(import.meta.dirname, 'dist');

const contentTypes = new Map([
  ['.css', 'text/css; charset=utf-8'],
  ['.html', 'text/html; charset=utf-8'],
  ['.ico', 'image/x-icon'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.png', 'image/png'],
  ['.svg', 'image/svg+xml'],
  ['.webp', 'image/webp'],
]);

function resolveAsset(pathname) {
  const decodedPath = decodeURIComponent(pathname);
  const relativePath = normalize(decodedPath).replace(/^[/\\]+/, '');
  if (relativePath.startsWith('..')) return null;
  return join(staticRoot, relativePath);
}

async function regularFile(path) {
  try {
    return (await stat(path)).isFile();
  } catch {
    return false;
  }
}

const server = createServer(async (request, response) => {
  if (request.url === '/health') {
    response.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
    response.end('{"status":"ok"}');
    return;
  }

  if (request.method !== 'GET' && request.method !== 'HEAD') {
    response.writeHead(405, { allow: 'GET, HEAD' });
    response.end();
    return;
  }

  try {
    const pathname = new URL(request.url ?? '/', 'http://localhost').pathname;
    const requestedPath = resolveAsset(pathname === '/' ? '/index.html' : pathname);
    const assetPath =
      requestedPath !== null && (await regularFile(requestedPath))
        ? requestedPath
        : join(staticRoot, 'index.html');

    response.writeHead(200, {
      'cache-control': assetPath.endsWith('index.html')
        ? 'no-cache'
        : 'public, max-age=31536000, immutable',
      'content-type': contentTypes.get(extname(assetPath)) ?? 'application/octet-stream',
    });

    if (request.method === 'HEAD') {
      response.end();
      return;
    }

    createReadStream(assetPath).pipe(response);
  } catch {
    response.writeHead(400, { 'content-type': 'text/plain; charset=utf-8' });
    response.end('Bad Request');
  }
});

server.listen(port, host, () => {
  console.log(`Frontend listening on http://${host}:${port}`);
});
