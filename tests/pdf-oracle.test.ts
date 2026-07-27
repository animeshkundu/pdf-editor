import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createCanvas, DOMMatrix, ImageData, Path2D } from '@napi-rs/canvas';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import * as mupdf from '../vendor/mupdf-wasm/dist/mupdf.js';
import { corpus } from './fixtures/pdf-corpus/corpus.js';

Object.assign(globalThis, { DOMMatrix, ImageData, Path2D });

// pdf.js rejects a factory URL containing Windows backslashes, so normalise the
// separators rather than handing it a native path. Without this the suite cannot run
// off Linux at all.
const asFactoryPath = (url: URL) => fileURLToPath(url).replaceAll('\\', '/');

const corpusDir = asFactoryPath(new URL('./fixtures/pdf-corpus/', import.meta.url));
const cMapUrl = asFactoryPath(new URL('../node_modules/pdfjs-dist/cmaps/', import.meta.url));
const standardFontDataUrl = asFactoryPath(
  new URL('../node_modules/pdfjs-dist/standard_fonts/', import.meta.url),
);
const workDir = mkdtempSync(join(tmpdir(), 'pdf-editor-oracle-'));
let qpdf = '';

const C8_TOLERANCE = {
  viewportPoints: 0.001,
  differentPixelRatio: 0.0001,
  maxChannelDelta: 32,
  rmse: 0.1,
} as const;

interface PageMetrics {
  readonly page: number;
  readonly viewportDelta: number;
  readonly differentPixels: number;
  readonly differentPixelRatio: number;
  readonly maxChannelDelta: number;
  readonly rmse: number;
}

interface OracleResult {
  readonly pages: readonly PageMetrics[];
  readonly textIdentical: boolean;
  readonly filteredRenderSha256: string;
}

function passesC8(page: PageMetrics): boolean {
  return (
    page.viewportDelta <= C8_TOLERANCE.viewportPoints &&
    page.differentPixelRatio <= C8_TOLERANCE.differentPixelRatio &&
    page.maxChannelDelta <= C8_TOLERANCE.maxChannelDelta &&
    page.rmse <= C8_TOLERANCE.rmse
  );
}

function canvasContext(width: number, height: number) {
  return createCanvas(width, height).getContext('2d');
}

function filterDocument(input: Uint8Array): {
  bytes: Uint8Array;
  repaired: boolean;
} {
  const document = mupdf.Document.openDocument(input, 'application/pdf') as mupdf.PDFDocument;
  let saved: mupdf.Buffer | undefined;
  try {
    const repaired = document.wasRepaired();
    for (let pageNumber = 0; pageNumber < document.countPages(); ++pageNumber) {
      const page = document.loadPage(pageNumber) as mupdf.PDFPage;
      try {
        page.filterContents({
          recurse: true,
          instanceForms: false,
          ascii: false,
          noUpdate: false,
          newlines: true,
        });
      } finally {
        page.destroy();
      }
    }
    saved = document.saveToBuffer('compress');
    return {
      bytes: Uint8Array.from(saved.asUint8Array()),
      repaired,
    };
  } finally {
    saved?.destroy();
    document.destroy();
  }
}

async function compareWithPdfJs(
  beforeBytes: Uint8Array,
  afterBytes: Uint8Array,
): Promise<OracleResult> {
  const beforeTask = getDocument({
    data: beforeBytes,
    cMapPacked: true,
    cMapUrl,
    standardFontDataUrl,
    useSystemFonts: true,
  });
  const afterTask = getDocument({
    data: afterBytes,
    cMapPacked: true,
    cMapUrl,
    standardFontDataUrl,
    useSystemFonts: true,
  });
  const before = await beforeTask.promise;
  const after = await afterTask.promise;
  const metrics: PageMetrics[] = [];
  const filteredRender = createHash('sha256');
  let textIdentical = before.numPages === after.numPages;

  try {
    expect(after.numPages).toBe(before.numPages);
    for (let pageNumber = 1; pageNumber <= before.numPages; ++pageNumber) {
      const beforePage = await before.getPage(pageNumber);
      const afterPage = await after.getPage(pageNumber);
      try {
        const beforeViewport = beforePage.getViewport({ scale: 2 });
        const afterViewport = afterPage.getViewport({ scale: 2 });
        const viewportDelta = Math.max(
          Math.abs(afterViewport.width - beforeViewport.width),
          Math.abs(afterViewport.height - beforeViewport.height),
        );

        const width = Math.ceil(beforeViewport.width);
        const height = Math.ceil(beforeViewport.height);
        expect(Math.ceil(afterViewport.width)).toBe(width);
        expect(Math.ceil(afterViewport.height)).toBe(height);
        const beforeContext = canvasContext(width, height);
        const afterContext = canvasContext(width, height);
        await beforePage.render({
          // @ts-expect-error pdf.js types name the browser context, but its Node path accepts this API-compatible canvas.
          canvasContext: beforeContext,
          viewport: beforeViewport,
        }).promise;
        await afterPage.render({
          // @ts-expect-error pdf.js types name the browser context, but its Node path accepts this API-compatible canvas.
          canvasContext: afterContext,
          viewport: afterViewport,
        }).promise;

        const beforePixels = beforeContext.getImageData(0, 0, width, height).data;
        const afterPixels = afterContext.getImageData(0, 0, width, height).data;
        filteredRender.update(`${pageNumber}:${width}:${height}:`);
        filteredRender.update(afterPixels);
        let differentPixels = 0;
        let maxChannelDelta = 0;
        let squaredDelta = 0;
        for (let offset = 0; offset < beforePixels.length; offset += 4) {
          let pixelDiffers = false;
          for (let channel = 0; channel < 4; ++channel) {
            const delta = Math.abs(
              beforePixels[offset + channel]! - afterPixels[offset + channel]!,
            );
            pixelDiffers ||= delta !== 0;
            maxChannelDelta = Math.max(maxChannelDelta, delta);
            squaredDelta += delta * delta;
          }
          differentPixels += Number(pixelDiffers);
        }
        metrics.push({
          page: pageNumber,
          viewportDelta,
          differentPixels,
          differentPixelRatio: differentPixels / (width * height),
          maxChannelDelta,
          rmse: Math.sqrt(squaredDelta / beforePixels.length),
        });

        const beforeText = (await beforePage.getTextContent()).items
          .filter((item): item is typeof item & { str: string } => 'str' in item)
          .map((item) => item.str);
        const afterText = (await afterPage.getTextContent()).items
          .filter((item): item is typeof item & { str: string } => 'str' in item)
          .map((item) => item.str);
        textIdentical &&= JSON.stringify(beforeText) === JSON.stringify(afterText);
      } finally {
        beforePage.cleanup();
        afterPage.cleanup();
      }
    }
  } finally {
    await beforeTask.destroy();
    await afterTask.destroy();
  }

  return {
    pages: metrics,
    textIdentical,
    filteredRenderSha256: filteredRender.digest('hex'),
  };
}

beforeAll(() => {
  const setup = spawnSync(process.execPath, ['scripts/setup-qpdf.mjs', '--print-path'], {
    encoding: 'utf8',
    shell: false,
  });
  if (setup.status !== 0) {
    throw new Error(setup.stderr || setup.stdout);
  }
  qpdf = setup.stdout.trim();
}, 120_000);

afterAll(() => {
  rmSync(workDir, { recursive: true, force: true });
});

describe('committed oracle corpus', () => {
  it('has fixed provenance, coverage, and bytes', () => {
    expect(new Set(corpus.map((document) => document.producer)).size).toBeGreaterThanOrEqual(8);
    const features = new Set(corpus.flatMap((document) => document.features));
    for (const required of [
      'simple-font',
      'cid-font',
      'subset-font',
      'fully-embedded-font',
      'type3-font',
      'tagged',
      'untagged',
      'optional-content-group',
      'transparency-group',
      'clipping-path',
      'rtl',
      'cjk',
      'linearized',
      'repair-on-open',
      'mobile-scanner',
    ]) {
      expect(features, `missing corpus feature ${required}`).toContain(required);
    }
    for (const document of corpus) {
      const bytes = readFileSync(join(corpusDir, document.file));
      expect(createHash('sha256').update(bytes).digest('hex')).toBe(document.sha256);
    }
  });
});

describe.sequential.each(corpus)('$file', (entry) => {
  it('survives the null filter under pdf.js and qpdf', async () => {
    const input = new Uint8Array(readFileSync(join(corpusDir, entry.file)));
    const filtered = filterDocument(input);
    expect(filtered.repaired).toBe(entry.features.includes('repair-on-open'));

    const output = join(workDir, entry.file);
    writeFileSync(output, filtered.bytes);
    const qpdfResult = spawnSync(qpdf, ['--check', output], {
      encoding: 'utf8',
      shell: false,
    });
    expect(qpdfResult.stderr, qpdfResult.stdout).toBe('');
    expect(qpdfResult.status, qpdfResult.stderr).toBe(0);

    const result = await compareWithPdfJs(input, filtered.bytes);
    expect(result.textIdentical).toBe(true);
    console.info(
      `[pdf-oracle] ${entry.file} ${result.filteredRenderSha256} ${JSON.stringify(result.pages)}`,
    );
    const failures = result.pages.filter((page) => !passesC8(page)).map((page) => page.page);
    expect(failures, 'C8 failures changed; update the finding, never the tolerance').toEqual(
      entry.expectedC8Failures ?? [],
    );

    if (entry.observedCeilings) {
      expect(
        result.filteredRenderSha256,
        'known failed render changed; inspect pixels and update the finding',
      ).toBe(entry.expectedFilteredRenderSha256);
      expect(
        Math.max(...result.pages.map((page) => page.differentPixelRatio)),
      ).toBeLessThanOrEqual(entry.observedCeilings.differentPixelRatio);
      expect(Math.max(...result.pages.map((page) => page.maxChannelDelta))).toBeLessThanOrEqual(
        entry.observedCeilings.maxChannelDelta,
      );
      expect(Math.max(...result.pages.map((page) => page.rmse))).toBeLessThanOrEqual(
        entry.observedCeilings.rmse,
      );
    }
  }, 180_000);
});
