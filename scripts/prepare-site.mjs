import { cpSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import path from 'node:path';

const source = 'dist';
const target = path.join('site', 'app');

if (!existsSync(path.join(source, 'index.html'))) {
  process.stderr.write(
    '[prepare-site] FAIL: dist/index.html is missing. Build the app first.\n',
  );
  process.exit(1);
}

rmSync(target, { recursive: true, force: true });
mkdirSync(target, { recursive: true });
cpSync(source, target, { recursive: true });
process.stdout.write('[prepare-site] copied the production app to site/app.\n');
