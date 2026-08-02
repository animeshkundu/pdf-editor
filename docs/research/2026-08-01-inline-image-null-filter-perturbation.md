# Inline-image null-filter perturbation

## Finding

The 502-byte `inline-image-embedded-ei.pdf` tokenizer fixture is a valid, deliberately
adversarial content stream: an unfiltered 12 by 1 DeviceGray inline image whose twelve sample
bytes contain `space E I space`. pdf.js reads the original as one inline image and exposes the
expected samples:

```text
01 20 45 49 20 02 03 04 05 06 07 08
```

Applying MuPDF's null sanitize filter changes the pdf.js rendering. At scale 2 on the 20 by 20
point page, the independent-reader measurement is:

```text
differentPixels:       4
differentPixelRatio:   0.0025
maxChannelDelta:       248
rmse:                  9.9699
filteredRenderSha256:  f04e9f8a53e33d1c60bdd8e28fdb865d7c2f129131a42a5e83a05e1505cf9365
```

This is a real filter perturbation, not a tokenizer effect. The TypeScript tokenizer does not
participate in the null-filter oracle.

## Before and after

The decoded content stream before filtering is 50 bytes:

```text
q BI /W 12 /H 1 /BPC 8 /CS /G ID <01> EI <02><03><04><05><06><07><08> EI Q
```

```text
71 20 42 49 20 2f 57 20 31 32 20 2f 48 20 31 20
2f 42 50 43 20 38 20 2f 43 53 20 2f 47 20 49 44
20 01 20 45 49 20 02 03 04 05 06 07 08 20 45 49
20 51
```

After filtering, the decoded stream is 48 bytes:

```text
BI /W 12/H 1/BPC 8/CS/G/D[0 1]ID <01> EI <02><03><04><05><06><07><08> EI
```

```text
42 49 20 2f 57 20 31 32 2f 48 20 31 2f 42 50 43
20 38 2f 43 53 2f 47 2f 44 5b 30 20 31 5d 49 44
20 01 20 45 49 20 02 03 04 05 06 07 08 20 45 49
```

The filter preserves all twelve sample bytes exactly. It canonicalizes dictionary spacing and
adds the default `/D [0 1]` decode array. The load-bearing change is structural: it drops the
outer `q` and trailing `Q`, so the real inline-image `EI` becomes the final two stream bytes.
pdf.js reports that it reached stream EOF without finding a valid `EI`, falls back to the last
`EI`, and decodes the filtered inline image as transparent zeroes. The original stream retains
` Q` after the real terminator and decodes to the intended twelve gray samples.

An explicit `/D [0 1]` was also added to the otherwise unchanged original stream as a negative
control. pdf.js still emitted `save`, `paintInlineImageXObject`, and `restore`, and the image
operator retained the same RGBA samples:

```text
[1,1,1,255, 32,32,32,255, 69,69,69,255, 73,73,73,255,
 32,32,32,255, 2,2,2,255, 3,3,3,255, 4,4,4,255,
 5,5,5,255, 6,6,6,255, 7,7,7,255, 8,8,8,255]
```

Therefore `/D [0 1]` alone does **not** reproduce the failure and is exonerated. An earlier
investigation note said it did reproduce; that statement was the contradictory one and was
incorrect. The fixture is intentionally minimal but not degenerate with respect to the
condition under test: its exact unfiltered sample length is defined by `/W`, `/H`, `/BPC`, and
`/CS`; pdf.js accepts and renders the original samples; and the filtered output remains
syntactically accepted by qpdf. It isolates an inline-image terminator-at-EOF interoperability
failure introduced by the sanitize-filter rewrite.

## Graphics-state operator control on the ADR 0020 corpus

Decoded physical page streams were tokenized before and after the same null sanitize filter.
Form XObject streams were counted separately. Every measured stream remained balanced.

`latex-pdftex.pdf` has 28 one-stream pages and no Form XObjects:

```text
before page streams: q=40, Q=40
before form streams: q=0,  Q=0
after page streams:  q=68, Q=68
after form streams:  q=0,  Q=0
```

The filter added exactly one balanced `q`/`Q` pair to every page. Existing page-local pairs
were retained: pages 7 and 8 changed from 2/2 to 3/3, page 10 from 9/9 to 10/10, page 17 from
26/26 to 27/27, and page 28 from 1/1 to 2/2; every initially zero-pair page became 1/1.
Because C8 passes page 1 but fails pages 2 through 28 while the operator-count transformation
is identical on pages 1 through 6 and 9, pair insertion alone does not explain the observed
page-dependent perturbation.

`libreoffice.pdf` has three physical page-content streams before filtering, consolidated to one
afterward, plus one Form XObject stream:

```text
before page streams: q=4, Q=4  (3 physical streams)
before form streams: q=1, Q=1 (1 Form stream)
after page streams:  q=4, Q=4  (1 physical stream)
after form streams:  q=1, Q=1 (1 Form stream)
```

No save/restore operator was dropped, added, or rebalanced in this document. The stream
consolidation may still be relevant, but `q`/`Q` count changes are excluded as the direct ADR
0020 mechanism for `libreoffice.pdf`.

## Recorded expectation

The corpus entry records page 1 in `expectedC8Failures`, the measured ceilings above, and the
filtered-render digest. This does not loosen C8. It makes the known failure executable: any
change to the failing page set, metrics ceiling, or filtered pixels requires inspecting and
updating this finding.
