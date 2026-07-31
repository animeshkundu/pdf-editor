import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

const output = path.join('.vercel', 'output');
const configPath = path.join(output, 'config.json');
const failures = [];

function check(condition, message) {
  if (!condition) failures.push(message);
}

check(existsSync(configPath), 'config.json is missing.');
const config = existsSync(configPath)
  ? JSON.parse(readFileSync(configPath, 'utf8'))
  : { routes: [] };
const routes = config.routes ?? [];
const mountRedirect = routes.findIndex((route) => route.src === '^/pdf-editor/?$');
const publicRewrite = routes.findIndex((route) => route.src === '^/pdf/$');
const filesystem = routes.findIndex((route) => route.handle === 'filesystem');
const globalHeaders = routes.find((route) => route.src === '^/.*$' && route.headers);
const appPolicy = routes.find(
  (route) => route.src === '^/(?:pdf-editor|pdf)/app/(?:index\\.html)?$',
);

check(config.version === 3, 'Build Output API version must be 3.');
check(mountRedirect >= 0, 'The internal mount redirect is missing.');
check(publicRewrite >= 0, 'The public landing rewrite is missing.');
check(
  mountRedirect < publicRewrite,
  'Internal mount redirects must precede public-space rewrites.',
);
check(filesystem === routes.length - 1, 'The filesystem handler must be the final route.');
for (const name of [
  'Strict-Transport-Security',
  'X-Content-Type-Options',
  'Referrer-Policy',
  'X-Frame-Options',
  'X-DNS-Prefetch-Control',
  'Content-Security-Policy',
  'Permissions-Policy',
]) {
  check(globalHeaders?.headers?.[name], `The ${name} response header is missing.`);
}
check(
  appPolicy?.headers?.['Content-Security-Policy']?.includes("frame-ancestors 'none'"),
  "The app response CSP must include frame-ancestors 'none'.",
);
const serialized = JSON.stringify(config);
check(!serialized.includes('Cross-Origin-Opener-Policy'), 'COOP must remain absent.');
check(!serialized.includes('Cross-Origin-Embedder-Policy'), 'COEP must remain absent.');
for (const file of [
  'pdf-editor/index.html',
  'pdf-editor/app/index.html',
  'pdf-editor/docs/index.html',
]) {
  check(existsSync(path.join(output, 'static', file)), `${file} is missing.`);
}

if (failures.length > 0) {
  for (const failure of failures) {
    process.stderr.write(`[check-vercel-output] FAIL: ${failure}\n`);
  }
  process.exit(1);
}
process.stdout.write('[check-vercel-output] mounted routes and security policy are valid.\n');
