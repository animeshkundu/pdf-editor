import { createReadStream, existsSync, readFileSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import path from 'node:path';

const portIndex = process.argv.indexOf('--port');
const port = Number(portIndex >= 0 ? process.argv[portIndex + 1] : 4180);
const root = path.resolve('.vercel/output/static');
const config = JSON.parse(readFileSync('.vercel/output/config.json', 'utf8'));
const MIME = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.txt': 'text/plain; charset=utf-8',
  '.wasm': 'application/wasm',
  '.xml': 'application/xml; charset=utf-8',
};

function destination(template, match) {
  return template.replace(/\$(\d+)/g, (_whole, index) => match[Number(index)] ?? '');
}

function fileFor(pathname) {
  const resolved = path.resolve(root, `.${pathname}`);
  if (!resolved.startsWith(`${root}${path.sep}`) && resolved !== root) return null;
  if (!existsSync(resolved) || !statSync(resolved).isFile()) return null;
  return resolved;
}

const server = createServer((request, response) => {
  let pathname = new URL(request.url ?? '/', 'http://localhost').pathname;
  const headers = {};

  for (const route of config.routes) {
    if (route.handle === 'filesystem') break;
    if (!route.src) continue;
    const match = pathname.match(new RegExp(route.src));
    if (!match) continue;
    Object.assign(headers, route.headers ?? {});
    if (route.status) {
      response.writeHead(route.status, headers);
      response.end();
      return;
    }
    if (route.dest) {
      pathname = destination(route.dest, match);
      if (!route.continue) break;
    } else if (!route.continue) {
      break;
    }
  }

  const file = fileFor(pathname);
  if (!file) {
    response.writeHead(404, { ...headers, 'Content-Type': 'text/plain; charset=utf-8' });
    response.end('Not found');
    return;
  }
  response.writeHead(200, {
    ...headers,
    'Content-Type':
      headers['Content-Type'] ?? MIME[path.extname(file)] ?? 'application/octet-stream',
  });
  createReadStream(file).pipe(response);
});

server.listen(port, '127.0.0.1', () => {
  process.stdout.write(`[serve-vercel-output] http://127.0.0.1:${port}\n`);
});
