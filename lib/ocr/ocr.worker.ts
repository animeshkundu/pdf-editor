interface NativeTextBlock {
  readonly rawValue: string;
  readonly boundingBox?: DOMRectReadOnly;
}

interface NativeTextDetector {
  detect(source: ImageData): Promise<readonly NativeTextBlock[]>;
}

interface NativeTextDetectorConstructor {
  new (): NativeTextDetector;
}

interface OcrRequest {
  readonly id: number;
  readonly pixels: ArrayBuffer;
  readonly width: number;
  readonly height: number;
}

interface OcrWorkerScope {
  readonly TextDetector?: NativeTextDetectorConstructor;
  addEventListener(type: 'message', listener: (event: MessageEvent<OcrRequest>) => void): void;
  postMessage(message: unknown): void;
}

const scope = self as unknown as OcrWorkerScope;

scope.addEventListener('message', (event: MessageEvent<OcrRequest>) => {
  void (async () => {
    const request = event.data;
    try {
      if (!scope.TextDetector) {
        scope.postMessage({
          id: request.id,
          ok: true,
          value: {
            available: false,
            text: '',
            blocks: [],
            reason:
              'This browser does not provide on-device text recognition. ' +
              'TextDetector is a Chromium-only API: it is absent in Firefox and Safari. ' +
              'No OCR model is downloaded because the application has zero egress (ADR 0002). ' +
              'For OCR in this browser, use a Chromium-based browser such as Chrome or Edge.',
          },
        });
        return;
      }
      const detector = new scope.TextDetector();
      const image = new ImageData(
        new Uint8ClampedArray(request.pixels),
        request.width,
        request.height,
      );
      const detected = await detector.detect(image);
      const blocks = detected
        .filter((block: NativeTextBlock) => block.rawValue.trim())
        .map((block: NativeTextBlock) => ({
          text: block.rawValue,
          ...(block.boundingBox
            ? {
                bounds: [
                  block.boundingBox.x,
                  block.boundingBox.y,
                  block.boundingBox.right,
                  block.boundingBox.bottom,
                ],
              }
            : {}),
        }));
      scope.postMessage({
        id: request.id,
        ok: true,
        value: {
          available: true,
          text: blocks.map((block: { readonly text: string }) => block.text).join('\n'),
          blocks,
        },
      });
    } catch (error) {
      scope.postMessage({
        id: request.id,
        ok: false,
        error: error instanceof Error ? error.message : 'Native OCR failed.',
      });
    }
  })();
});
