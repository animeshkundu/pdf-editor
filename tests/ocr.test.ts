import { describe, expect, it } from 'vitest';
import {
  browserOcrDescription,
  projectOcrRenderSize,
  projectOcrResult,
} from '@/lib/ocr/client';

describe('browserOcrDescription', () => {
  it('does not claim browser support outside a browser context', () => {
    expect(browserOcrDescription()).toEqual({
      likelyAvailable: false,
      description:
        'OCR needs a browser with Web Workers and WebAssembly. The bundled engine is not loaded until recognition starts.',
    });
  });

  it('describes the bundled engine as lazy, local, and cross-browser', () => {
    const description = browserOcrDescription().description;
    expect(description).toContain('bundled engine');
    expect(description).toContain('not loaded until recognition starts');
    expect(description).not.toContain('TextDetector');
    expect(description).not.toContain('switch browsers');
  });
});

describe('OcrResult protocol', () => {
  it('projects block geometry, filters empty words, and carries independent PDF output', () => {
    const result = projectOcrResult({
      text: 'Recognized text',
      confidence: 91.5,
      pdf: [37, 80, 68, 70],
      blocks: [
        {
          text: 'Recognized text',
          confidence: 91.5,
          bbox: { x0: 10, y0: 20, x1: 300, y1: 50 },
          paragraphs: [
            {
              lines: [
                {
                  words: [
                    {
                      text: 'Recognized',
                      confidence: 93,
                      bbox: { x0: 10, y0: 20, x1: 150, y1: 50 },
                    },
                    {
                      text: ' ',
                      confidence: 1,
                      bbox: { x0: 151, y0: 20, x1: 159, y1: 50 },
                    },
                    {
                      text: 'text',
                      confidence: 90,
                      bbox: { x0: 160, y0: 20, x1: 300, y1: 50 },
                    },
                  ],
                },
              ],
            },
          ],
        },
        {
          text: ' ',
          confidence: 0,
          bbox: { x0: 0, y0: 0, x1: 0, y1: 0 },
          paragraphs: [],
        },
      ],
    });

    expect(result.available).toBe(true);
    expect(result.blocks).toEqual([
      {
        text: 'Recognized text',
        confidence: 91.5,
        bounds: [10, 20, 300, 50],
      },
    ]);
    expect(result.words.map(({ confidence }) => confidence)).toEqual([93, 90]);
    expect(new Uint8Array(result.searchablePdf ?? new ArrayBuffer(0))).toEqual(
      new Uint8Array([37, 80, 68, 70]),
    );
  });

  it('handles recognition output with no blocks or PDF', () => {
    const result = projectOcrResult({
      text: '',
      confidence: 0,
      blocks: null,
      pdf: null,
    });

    expect(result.blocks).toEqual([]);
    expect(result.words).toEqual([]);
    expect(result.searchablePdf).toBeUndefined();
  });

  it.each([
    ['desktop', 4_000_000],
    ['iOS', 1_000_000],
  ])('keeps the assembled %s OCR canvas within 90%% of the render budget', (_name, budget) => {
    const size = projectOcrRenderSize({ width: 612, height: 792 }, budget);
    expect(size.width * size.height).toBeLessThanOrEqual(Math.floor(budget * 0.9));
    expect(size.scale).toBeLessThanOrEqual(3);
  });
});
