export interface CorpusDocument {
  readonly file: string;
  readonly sha256: string;
  readonly producer: string;
  readonly pages: number;
  readonly source: string;
  readonly license: string;
  readonly features: readonly string[];
  readonly expectedC8Failures?: readonly number[];
  readonly observedCeilings?: {
    readonly differentPixelRatio: number;
    readonly maxChannelDelta: number;
    readonly rmse: number;
  };
  readonly expectedFilteredRenderSha256?: string;
}

const PDFBOX_REVISION = '17d5266a909a7631b08e0a3b4c8c6af08c5f0381';
const PDFBOX_SOURCE = `https://github.com/apache/pdfbox/blob/${PDFBOX_REVISION}/`;
const PDFBOX_LICENSE = 'Apache-2.0';

export const corpus: readonly CorpusDocument[] = [
  {
    file: 'distiller-tagged-linearized.pdf',
    sha256: 'bef74b4a96b426b56a87e7646d6e7b4e03e20793226df95af40d31ec68dfa8ec',
    producer: 'Acrobat Distiller 6.0 (Windows)',
    pages: 1,
    source: `${PDFBOX_SOURCE}pdfbox/src/test/resources/input/sampleForSpec.pdf`,
    license: PDFBOX_LICENSE,
    features: ['tagged', 'linearized', 'simple-font'],
  },
  {
    file: 'word-cid.pdf',
    sha256: 'cf4d80ac8466d07678de7651d63fda747a34b600c57fb4a8eb8faf9d612465ae',
    producer: 'Adobe PDF Services / Microsoft Word 2019',
    pages: 1,
    source:
      `${PDFBOX_SOURCE}pdfbox/src/test/resources/input/` + 'PDFBOX-4531-bidi-ligature-2.pdf',
    license: PDFBOX_LICENSE,
    features: ['untagged', 'cid-font', 'subset-font'],
  },
  {
    file: 'ghostscript.pdf',
    sha256: '2e8b87ea72de7dd54176354706a5d7ff9e64a12624e603ffac64aa55743bf581',
    producer: 'GPL Ghostscript 8.15',
    pages: 9,
    source: `${PDFBOX_SOURCE}pdfbox/src/test/resources/input/rendering/survey.pdf`,
    license: PDFBOX_LICENSE,
    features: ['untagged', 'simple-font', 'clipping-path'],
    // Recorded as failing C8 on page 5 via maxChannelDelta 64. It does not reproduce:
    // the maximum across all nine pages is 7 and page 5's is 4, identically on Windows,
    // on Linux, and under this suite on GitHub-hosted CI. The recorded ratio (0.000027)
    // and rmse (0.057) both passed their limits, so channel delta was the only failing
    // metric and the gap is a factor of 9 to 16 rather than marginal. See
    // docs/research/2026-07-26-redaction-and-editing-on-the-forked-engine.md.
    //
    // observedCeilings and expectedFilteredRenderSha256 are gone with the failure they
    // described. They bound a KNOWN failure; a document that passes C8 outright is
    // asserted by C8 itself, which is the stronger statement.
    expectedC8Failures: [],
  },
  {
    file: 'latex-pdftex.pdf',
    sha256: 'cdc74cc6db82dae5f68ae30a32ac154a6b35eb698f08749f3c6d5a2c2a0a2680',
    producer: 'pdfTeX-0.14f / TeX',
    pages: 28,
    source: `${PDFBOX_SOURCE}pdfbox/src/test/resources/input/cweb.pdf`,
    license: PDFBOX_LICENSE,
    features: ['untagged', 'simple-font', 'subset-font'],
    // The failing pages reproduce exactly. The ceilings and the render digest did not,
    // and are updated to measured values that three independent environments agree on
    // byte for byte. The previous ceilings were also self-inconsistent with the digest
    // they shipped beside.
    expectedC8Failures: Array.from({ length: 27 }, (_, index) => index + 2),
    observedCeilings: {
      differentPixelRatio: 0.005845,
      maxChannelDelta: 66,
      rmse: 0.23538,
    },
    expectedFilteredRenderSha256:
      '6750fe34c2cd910c2fa8b3d8aff93e2990a353b77156766d3032618d67f581e1',
  },
  {
    file: 'libreoffice.pdf',
    sha256: 'b8771ccc79090080c569c722ddda48276750bbd786458119e08e131e4ca1958a',
    producer: 'LibreOffice 25.2.3.2 Writer',
    pages: 1,
    source:
      `${PDFBOX_SOURCE}pdfbox-layout-awt/src/test/resources/pdf/` +
      'GlyphLayoutDIN91379Form.pdf',
    license: PDFBOX_LICENSE,
    features: ['tagged', 'cid-font', 'subset-font', 'fully-embedded-font'],
    // As above. The recorded rmse ceiling of 0.408 was below the measured 0.40851, so it
    // would have failed even after the digest was corrected.
    expectedC8Failures: [1],
    observedCeilings: {
      differentPixelRatio: 0.009585,
      maxChannelDelta: 66,
      rmse: 0.40851,
    },
    expectedFilteredRenderSha256:
      'bcff92cdfc0b386301cd280a798be797a07f6fba282f9ab29733a68c9b4ba9c0',
  },
  {
    file: 'rtl-quartz.pdf',
    sha256: 'dd4947a7b825c2827729065cfff07115f0742d2c7bdcb048628097c62d1acbb3',
    producer: 'Mac OS X 10.10.5 Quartz PDFContext / Pages',
    pages: 1,
    source: `${PDFBOX_SOURCE}pdfbox/src/test/resources/org/apache/pdfbox/text/BidiSample.pdf`,
    license: PDFBOX_LICENSE,
    features: ['untagged', 'rtl', 'cid-font'],
  },
  {
    file: 'apache-fop.pdf',
    sha256: 'ab356726b3d0bc0e48d0312a4369aa45d21e68d8db2ac2f61f71d99d52eec68f',
    producer: 'Apache FOP Version svn-trunk',
    pages: 1,
    source:
      `${PDFBOX_SOURCE}pdfbox/src/test/resources/input/rendering/` +
      'tiger-as-form-xobject.pdf',
    license: PDFBOX_LICENSE,
    features: ['untagged', 'form-xobject', 'clipping-path'],
  },
  {
    file: 'mobile-camscanner.pdf',
    sha256: 'd33e9e99c75fc743bd21cbfeab0e5877da874dbe8e92ad88ffd9a44e3ce5a8ba',
    producer: 'CamScanner (intsig.com pdf producer)',
    pages: 12,
    source:
      'https://archive.org/download/EducomBulletinApr1967/' +
      'Educom%20Bulletin%20Apr%201967.pdf',
    license: 'CC Public Domain Mark 1.0',
    features: ['mobile-scanner', 'untagged', 'image'],
  },
  {
    file: 'type3-font.pdf',
    sha256: '9bbb0aac11fccea82211d1f2269e1ec37cbe30c2481a18b5c765d1a04bb1bb83',
    producer: 'veraPDF test corpus',
    pages: 1,
    source:
      'https://github.com/veraPDF/veraPDF-corpus/blob/' +
      '49de56cd987929932c9e4fbbbe67d052bf44ef83/' +
      'PDF_A-4/6.2%20Graphics/6.2.9%20Transparency/' +
      'veraPDF%20test%20suite%206-2-9-t04-fail-a.pdf',
    license: 'CC-BY-4.0',
    features: ['type3-font', 'untagged'],
  },
  {
    file: 'transparency-group.pdf',
    sha256: '7aaedc9bcf71d8b726c986db3cb4cc22f6d7ec90fe19a61ecbd2574e251feb85',
    producer: 'Apache PDFBox transparency regression fixture',
    pages: 1,
    source: `${PDFBOX_SOURCE}pdfbox/src/test/resources/input/PDFBOX-3195.pdf`,
    license: PDFBOX_LICENSE,
    features: ['transparency-group', 'untagged'],
  },
  {
    file: 'ocg-acrobat.pdf',
    sha256: '88dd0f53b5e9d0596aba4853bce26a11d25790fc7f25a20462c4908e9e68bd99',
    producer: 'Adobe Acrobat 10.268',
    pages: 1,
    source:
      `${PDFBOX_SOURCE}pdfbox/src/test/resources/org/apache/pdfbox/encryption/` +
      'Acroform-PDFBOX-2333.pdf',
    license: PDFBOX_LICENSE,
    features: ['optional-content-group', 'untagged', 'fully-embedded-font'],
  },
  {
    file: 'cjk-itext.pdf',
    sha256: 'ad13a85449c62b7665d552e3702be867de213efb0defd8742a1d5a3d748fbfc9',
    producer: 'iText / nPDF',
    pages: 1,
    source:
      `${PDFBOX_SOURCE}pdfbox/src/test/resources/input/` +
      'PDFBOX-5350-JX57O5E5YG6XM4FZABPULQGTW4OXPCWA-p1-reduced.pdf',
    license: PDFBOX_LICENSE,
    features: ['cjk', 'cid-font', 'linearized', 'subset-font'],
  },
  {
    file: 'repaired-bad-startxref.pdf',
    sha256: '247cb9400c68e5ec004cba5090fd15c68f800a42d8db86b2ba59189c3b5d0bbf',
    producer: 'iText 5.5.0; startxref deliberately invalidated',
    pages: 1,
    source:
      `${PDFBOX_SOURCE}examples/src/test/resources/org/apache/pdfbox/examples/` +
      'pdmodel/document.pdf',
    license: PDFBOX_LICENSE,
    features: ['repair-on-open', 'untagged', 'simple-font'],
  },
] as const;
