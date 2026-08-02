import { cpSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const SITE = 'site';
const OUTPUT = path.join('.vercel', 'output');
const STATIC = path.join(OUTPUT, 'static');
const MOUNT = 'pdf-editor';
const PUBLIC = 'pdf';
const REQUIRED = [
  'index.html',
  'styles.css',
  'favicon.svg',
  'images/editor-markup-light.webp',
  'images/editor-markup-dark.webp',
  'images/editor-protect-light.webp',
  'images/editor-protect-dark.webp',
  'docs/index.html',
  'app/index.html',
  'app/sw.js',
  'app/ocr/tesseract-7.0.0/worker.min.js',
  'app/ocr/tesseract-7.0.0/tesseract-core-lstm.wasm.js',
  'app/ocr/tesseract-7.0.0/tesseract-core-simd-lstm.wasm.js',
  'app/ocr/tesseract-7.0.0/tesseract-core-relaxedsimd-lstm.wasm.js',
  'app/ocr/eng-1.0.0/eng.traineddata.gz',
  '.well-known/security.txt',
  'robots.txt',
  'sitemap.xml',
];

const PERMISSIONS_POLICY =
  'accelerometer=(), ambient-light-sensor=(), autoplay=(), battery=(), bluetooth=(), ' +
  'browsing-topics=(), camera=(), display-capture=(), encrypted-media=(), gamepad=(), ' +
  'geolocation=(), gyroscope=(), hid=(), idle-detection=(), local-fonts=(), ' +
  'magnetometer=(), microphone=(), midi=(), payment=(), picture-in-picture=(), ' +
  'publickey-credentials-get=(), screen-wake-lock=(), serial=(), usb=(), ' +
  'xr-spatial-tracking=(), clipboard-read=(self), clipboard-write=(self), fullscreen=(self)';
const SECURITY_HEADERS = {
  'Strict-Transport-Security': 'max-age=63072000; includeSubDomains',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'X-Frame-Options': 'DENY',
  'X-DNS-Prefetch-Control': 'off',
  'Content-Security-Policy': "frame-ancestors 'none'",
  'Permissions-Policy': PERMISSIONS_POLICY,
};
const CACHE_REVALIDATE = 'public, max-age=0, must-revalidate';
const CACHE_IMMUTABLE = 'public, max-age=31536000, immutable';

function fail(message) {
  process.stderr.write(`[build-vercel-output] FAIL: ${message}\n`);
  process.exit(1);
}

function responsePolicy(indexPath) {
  const html = readFileSync(indexPath, 'utf8');
  const tag = html.match(/<meta\b[^>]*http-equiv=["']Content-Security-Policy["'][^>]*>/i);
  if (!tag) fail(`no meta Content-Security-Policy found in ${indexPath}.`);
  const content = tag[0].match(/content=(["'])([\s\S]*?)\1/i);
  if (!content) fail(`meta Content-Security-Policy in ${indexPath} has no content.`);
  return `${content[2]}; frame-ancestors 'none'`;
}

rmSync(OUTPUT, { recursive: true, force: true });
mkdirSync(STATIC, { recursive: true });
cpSync(SITE, path.join(STATIC, MOUNT), { recursive: true });

for (const file of REQUIRED) {
  const target = path.join(STATIC, MOUNT, file);
  let stats;
  try {
    stats = statSync(target);
  } catch {
    fail(`missing required publication file: ${path.join(SITE, file)}.`);
  }
  if (!stats.isFile()) fail(`required publication path is not a file: ${target}.`);
}

const appCsp = responsePolicy(path.join(STATIC, MOUNT, 'app', 'index.html'));
const landingCsp = responsePolicy(path.join(STATIC, MOUNT, 'index.html'));
const docsCsp = responsePolicy(path.join(STATIC, MOUNT, 'docs', 'index.html'));
const SPACE = `(?:${MOUNT}|${PUBLIC})`;
const routes = [
  { src: '^/.*$', headers: SECURITY_HEADERS, continue: true },
  { src: '^/.*$', headers: { 'Cache-Control': CACHE_REVALIDATE }, continue: true },
  {
    src: `^/${SPACE}/app/assets/.*$`,
    headers: { 'Cache-Control': CACHE_IMMUTABLE },
    continue: true,
  },
  {
    src: `^/${SPACE}/app/sw\\.js$`,
    headers: { 'Cache-Control': CACHE_REVALIDATE },
    continue: true,
  },
  {
    src: `^/${SPACE}/app/.*\\.wasm$`,
    headers: {
      'Content-Type': 'application/wasm',
      'Cache-Control': CACHE_IMMUTABLE,
    },
    continue: true,
  },
  {
    src: `^/${SPACE}/app/(?:index\\.html)?$`,
    headers: { 'Content-Security-Policy': appCsp },
    continue: true,
  },
  {
    src: `^/${SPACE}/(?:index\\.html)?$`,
    headers: { 'Content-Security-Policy': landingCsp },
    continue: true,
  },
  {
    src: `^/${SPACE}/docs/(?:index\\.html)?$`,
    headers: { 'Content-Security-Policy': docsCsp },
    continue: true,
  },
  { src: '^/$', status: 308, headers: { Location: `/${PUBLIC}/` } },
  { src: `^/${MOUNT}/?$`, status: 308, headers: { Location: `/${PUBLIC}/` } },
  { src: `^/${MOUNT}/app/?$`, status: 308, headers: { Location: `/${PUBLIC}/app/` } },
  { src: `^/${MOUNT}/docs/?$`, status: 308, headers: { Location: `/${PUBLIC}/docs/` } },
  { src: `^/${PUBLIC}$`, status: 308, headers: { Location: `/${PUBLIC}/` } },
  { src: `^/${PUBLIC}/app$`, status: 308, headers: { Location: `/${PUBLIC}/app/` } },
  { src: `^/${PUBLIC}/docs$`, status: 308, headers: { Location: `/${PUBLIC}/docs/` } },
  { src: `^/${PUBLIC}/$`, dest: `/${MOUNT}/index.html` },
  { src: `^/${PUBLIC}/app/$`, dest: `/${MOUNT}/app/index.html` },
  { src: `^/${PUBLIC}/docs/$`, dest: `/${MOUNT}/docs/index.html` },
  { src: `^/${PUBLIC}/(.*)$`, dest: `/${MOUNT}/$1` },
  { src: '^/robots\\.txt$', dest: `/${MOUNT}/robots.txt` },
  { src: '^/sitemap\\.xml$', dest: `/${MOUNT}/sitemap.xml` },
  { src: '^/\\.well-known/security\\.txt$', dest: `/${MOUNT}/.well-known/security.txt` },
  { handle: 'filesystem' },
];

writeFileSync(
  path.join(OUTPUT, 'config.json'),
  `${JSON.stringify({ version: 3, routes }, null, 2)}\n`,
);
process.stdout.write(
  `[build-vercel-output] assembled ${STATIC}/${MOUNT} with ${routes.length} routes.\n`,
);
