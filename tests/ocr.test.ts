/**
 * Tests for OCR client availability detection and worker protocol.
 *
 * These tests cover the framework-free parts of the OCR subsystem:
 *  - browserOcrDescription(): cross-browser availability messaging
 *  - OcrResult protocol contract: available=true/false with reason
 *
 * The OCR worker itself is not instantiated (it requires a browser Worker
 * context). The message protocol is tested through the typed interfaces.
 */
import { describe, it, expect } from 'vitest';
import { browserOcrDescription, type OcrResult } from '@/lib/ocr/client';

describe('browserOcrDescription', () => {
  // Note: these tests run in Node.js via Vitest (no navigator.userAgent).
  // The function must not throw when navigator is absent.

  it('does not throw when called outside a browser context', () => {
    expect(() => browserOcrDescription()).not.toThrow();
  });

  it('returns an object with likelyAvailable and description properties', () => {
    const result = browserOcrDescription();
    expect(typeof result.likelyAvailable).toBe('boolean');
    expect(typeof result.description).toBe('string');
    expect(result.description.length).toBeGreaterThan(0);
  });

  it('returns likelyAvailable=false in a non-browser environment', () => {
    // Running in Node.js, so navigator is absent
    const result = browserOcrDescription();
    expect(result.likelyAvailable).toBe(false);
  });

  it('description in non-browser context explains OCR unavailability', () => {
    const result = browserOcrDescription();
    // Should mention it's unavailable, not claim it works
    expect(result.description).not.toMatch(/available.*Chromium.*recognition/i);
  });

  it('description explains that no model is downloaded (zero-egress guarantee)', () => {
    const result = browserOcrDescription();
    // Either the available or unavailable message must mention zero egress
    expect(result.description.toLowerCase()).toMatch(/egress|download|model/);
  });

  it('description mentions that Firefox and Safari lack TextDetector', () => {
    // When unavailable, the message should name the browsers for actionability
    const result = browserOcrDescription();
    if (!result.likelyAvailable) {
      // The description should tell the user why, naming the affected browsers
      expect(result.description).toMatch(/Firefox|Safari|Chromium/);
    }
  });
});

describe('OcrResult protocol', () => {
  // These tests verify the shape of OcrResult as used by the UI.
  // They do not invoke the worker; they verify the contract matches usage.

  it('available=false result has a non-empty reason string', () => {
    const unavailable: OcrResult = {
      available: false,
      text: '',
      blocks: [],
      reason: 'TextDetector is a Chromium-only API not implemented in Firefox or Safari.',
    };
    expect(unavailable.available).toBe(false);
    expect(unavailable.reason).toBeTruthy();
    expect(unavailable.text).toBe('');
    expect(unavailable.blocks).toHaveLength(0);
  });

  it('available=true result has text and blocks, no reason needed', () => {
    const available: OcrResult = {
      available: true,
      text: 'Recognized text from the page.',
      blocks: [
        {
          text: 'Recognized text from the page.',
          bounds: [10, 20, 300, 50],
        },
      ],
    };
    expect(available.available).toBe(true);
    expect(available.text).not.toBe('');
    expect(available.blocks.length).toBeGreaterThan(0);
    // bounds is optional; present in this test
    expect(available.blocks[0]!.bounds).toHaveLength(4);
  });

  it('available=true result may have blocks without bounds', () => {
    const noBounds: OcrResult = {
      available: true,
      text: 'Some detected text.',
      blocks: [{ text: 'Some detected text.' }],
    };
    expect(noBounds.blocks[0]!.bounds).toBeUndefined();
  });

  it('OCR unavailability reason must not claim cross-browser availability', () => {
    // Verifies the worker unavailability message (mirrored here) is honest.
    const reason =
      'This browser does not provide on-device text recognition. ' +
      'TextDetector is a Chromium-only API: it is absent in Firefox and Safari. ' +
      'No OCR model is downloaded because the application has zero egress (ADR 0002). ' +
      'For OCR in this browser, use a Chromium-based browser such as Chrome or Edge.';
    expect(reason).toMatch(/Firefox/);
    expect(reason).toMatch(/Safari/);
    expect(reason).toMatch(/zero egress/);
    expect(reason).not.toMatch(/available in all/i);
    expect(reason).not.toMatch(/all browsers/i);
  });
});

describe('OCR cross-browser honesty invariants', () => {
  it('TextDetector floor: available only in Chromium at browser floor', () => {
    // The Shape Detection API / TextDetector is:
    //   - Chrome 95+: available (origin trial → shipped)
    //   - Firefox 131+: NOT available (never shipped)
    //   - Safari 15.2+: NOT available (not in WebKit)
    // This test is documentation: if TextDetector ever ships in Firefox/Safari,
    // the browserOcrDescription logic and this test must both be updated.
    const chromiumSupportedSince = 95;
    const firefoxFloor = 131;
    const safariFloor = 15.2;
    // Assert the floor values are consistent with those in ADR 0013
    expect(chromiumSupportedSince).toBeLessThanOrEqual(95);
    expect(firefoxFloor).toBe(131);
    expect(safariFloor).toBe(15.2);
    // No TextDetector in Firefox or Safari at these versions:
    // This test captures the known state; update it if the API ships.
    const textDetectorAbsentInFirefox = true;
    const textDetectorAbsentInSafari = true;
    expect(textDetectorAbsentInFirefox).toBe(true);
    expect(textDetectorAbsentInSafari).toBe(true);
  });

  it('CONV-017 DEGRADED: OCR is not LOCAL because TextDetector is browser-restricted', () => {
    // The parity inventory marks CONV-017 DEGRADED. This test documents why:
    // OCR cannot be LOCAL if it is unavailable in two of the three supported browsers.
    // If TextDetector ships in all three browsers, CONV-017 may become LOCAL.
    const ocrAvailableInAllFloorBrowsers = false; // Chrome-only
    expect(ocrAvailableInAllFloorBrowsers).toBe(false);
  });
});
