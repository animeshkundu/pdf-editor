import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

function packageVersion(path: string): string {
  return (
    JSON.parse(readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8')) as {
      readonly version: string;
    }
  ).version;
}

export const OCR_VERSIONS = {
  tesseract: packageVersion('../node_modules/tesseract.js/package.json'),
  core: packageVersion('../node_modules/tesseract.js-core/package.json'),
  language: packageVersion('../node_modules/@tesseract.js-data/eng/package.json'),
} as const;

export default OCR_VERSIONS;
