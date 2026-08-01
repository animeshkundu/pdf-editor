# UI surface sweep ledger

## Run contract

This ledger records a completed production-artifact run on 2026-08-01. Playwright drove
`http://127.0.0.1:4180/pdf/app/` from the assembled Build Output API artifact served by
`scripts/serve-vercel-output.mjs`. The editor was never driven through the Vite development
server or a root-mounted preview.

The panel matrix is compact, comfortable, and touch density; light and dark theme; wide
1440×900 and narrow 380×780 viewports. Chromium produced the 218 committed screenshots under
`screenshots/ui-sweep/`; Firefox repeated the same reach and assertion routes. Every test
installed fail-closed cross-origin-request, console-error, and page-error guards.

Reproduce with:

1. `npm run build:site`
2. `npx playwright test --config tests/e2e/playwright.config.ts tests/e2e/ui-ux.e2e.ts`
3. Inspect `screenshots/ui-sweep/`; there are exactly 218 PNG files.

## Screenshot matrix

The brace notation below names complete sets of existing files, not future placeholders.

| Surface                 | Exact reach route and fixture                                                         | Input                | Outcome      | Committed evidence                                                                         |
| ----------------------- | ------------------------------------------------------------------------------------- | -------------------- | ------------ | ------------------------------------------------------------------------------------------ |
| Public landing          | Open `/pdf/`; inspect privacy copy; follow Open a PDF                                 | Keyboard and pointer | PASS         | `screenshots/ui-sweep/landing-{wide,narrow}.png`                                           |
| Empty editor            | Open `/pdf/app/`; inspect landmarks, welcome, privacy claim, header, rail, and status | Keyboard and pointer | PASS         | `screenshots/ui-sweep/empty-{compact,comfortable,touch}-{light,dark}-{wide,narrow}.png`    |
| Pages                   | Open `distiller-tagged-linearized.pdf`; Pages                                         | Keyboard and pointer | PASS         | `screenshots/ui-sweep/pages-{compact,comfortable,touch}-{light,dark}-{wide,narrow}.png`    |
| Outline                 | Open fixture; Outline                                                                 | Keyboard and pointer | PASS         | `screenshots/ui-sweep/outline-{compact,comfortable,touch}-{light,dark}-{wide,narrow}.png`  |
| Attachments empty state | Open fixture; Files                                                                   | Keyboard and pointer | PASS         | `screenshots/ui-sweep/files-{compact,comfortable,touch}-{light,dark}-{wide,narrow}.png`    |
| Find                    | Open fixture; Find                                                                    | Keyboard and pointer | PASS         | `screenshots/ui-sweep/find-{compact,comfortable,touch}-{light,dark}-{wide,narrow}.png`     |
| Markup                  | Open fixture; Markup                                                                  | Keyboard and pointer | DEFECT-FIXED | `screenshots/ui-sweep/markup-{compact,comfortable,touch}-{light,dark}-{wide,narrow}.png`   |
| Comments                | Open fixture; Comments                                                                | Keyboard and pointer | DEFECT-FIXED | `screenshots/ui-sweep/comments-{compact,comfortable,touch}-{light,dark}-{wide,narrow}.png` |
| Organize                | Open fixture; Organize                                                                | Keyboard and pointer | DEFECT-FIXED | `screenshots/ui-sweep/organize-{compact,comfortable,touch}-{light,dark}-{wide,narrow}.png` |
| Forms                   | Open fixture; Forms                                                                   | Keyboard and pointer | DEFECT-FIXED | `screenshots/ui-sweep/forms-{compact,comfortable,touch}-{light,dark}-{wide,narrow}.png`    |
| Protect                 | Open fixture; Protect                                                                 | Keyboard and pointer | DEFECT-FIXED | `screenshots/ui-sweep/protect-{compact,comfortable,touch}-{light,dark}-{wide,narrow}.png`  |
| Compare                 | Open fixture; Compare                                                                 | Keyboard and pointer | PASS         | `screenshots/ui-sweep/compare-{compact,comfortable,touch}-{light,dark}-{wide,narrow}.png`  |
| Convert                 | Open fixture; Convert                                                                 | Keyboard and pointer | PASS         | `screenshots/ui-sweep/convert-{compact,comfortable,touch}-{light,dark}-{wide,narrow}.png`  |
| Accessibility           | Open fixture; Access                                                                  | Keyboard and pointer | PASS         | `screenshots/ui-sweep/access-{compact,comfortable,touch}-{light,dark}-{wide,narrow}.png`   |
| Print                   | Open fixture; Print                                                                   | Keyboard and pointer | DEFECT-FIXED | `screenshots/ui-sweep/print-{compact,comfortable,touch}-{light,dark}-{wide,narrow}.png`    |
| Automation              | Open fixture; Automate                                                                | Keyboard and pointer | DEFECT-FIXED | `screenshots/ui-sweep/automate-{compact,comfortable,touch}-{light,dark}-{wide,narrow}.png` |
| History                 | Open fixture; History                                                                 | Keyboard and pointer | PASS         | `screenshots/ui-sweep/history-{compact,comfortable,touch}-{light,dark}-{wide,narrow}.png`  |
| Capability scope        | Open fixture; Scope                                                                   | Keyboard and pointer | PASS         | `screenshots/ui-sweep/scope-{compact,comfortable,touch}-{light,dark}-{wide,narrow}.png`    |

`DEFECT-FIXED` panel rows replaced bare browser controls with the designed Radix control layer.
The run opens portalled options and colour controls, drags the opacity slider, excludes only
Radix's hidden form-compatibility input, and enforces 24×24 CSS px compact/comfortable targets
and 44×44 CSS px touch targets. Every visible disabled panel control resolves a visible
`aria-describedby` explanation.

## Behavioural surfaces and states

| Surface or state                                               | Exact reach route                                                                                                               | Fixture                                          | Outcome and acceptance evidence                                                                                                                                               |
| -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Global toolbar, long title, page count, LOCAL indicator        | Open a file whose supplied name repeats `Quarterly-local-review-`; resize through 1600, 1280, 1100, 900, and 380 px             | Tagged fixture bytes with long supplied filename | DEFECT-FIXED — title remains visible or ellipsized, full name remains accessible, and `document.title` changes                                                                |
| Narrow rail, header, and status                                | Open fixture; set 380×780; inspect every visible header, rail, and status control bounding box                                  | Tagged fixture                                   | DEFECT-FIXED — all 16 rail entries and all visible chrome controls stay within the viewport                                                                                   |
| Current tool and absolute Escape                               | Enter Select mode and zoom; press M, Shift+M, D, Shift+D, R, and F; press Escape; repeat R while Line style has focus           | Tagged fixture                                   | DEFECT-FIXED — status names every tool, view state survives tool changes, and Escape resets from a focused property control                                                   |
| Tool property drawer                                           | Markup; Tool properties; operate colour, opacity, line style, units, locked, and read-only                                      | Tagged fixture                                   | DEFECT-FIXED — no native select, details, color, range, or checkbox controls remain                                                                                           |
| Concurrent contextual panels                                   | Open Pages, Markup, and Forms together; drag Markup resize handle; collapse; reload and reopen same named document              | Tagged fixture named `panel-layout.pdf`          | DEFECT-FIXED — open set, width, and collapsed state persist locally per document                                                                                              |
| Command palette                                                | Commands; filter; arrow; Enter; Escape                                                                                          | Empty and open-document shell                    | PASS — modal focus trap and origin restoration                                                                                                                                |
| Shortcut editor                                                | Commands; Edit shortcuts; remap markup family to G; close; press G                                                              | Tagged fixture                                   | DEFECT-FIXED — remapping applies immediately and persists locally; reset/import/export controls are present                                                                   |
| Keyboard text selection                                        | Focus Document pages; Shift+Right three times; Shift+Left once                                                                  | Tagged fixture                                   | DEFECT-FIXED — cancellable engine search quads paint non-transparent pixels into the existing canvas overlay and feed the selection action toolbar; no page DOM text is added |
| Selection action toolbar                                       | Make pointer and keyboard selections; copy, edit, highlight, underline, strikeout, comment, and redact                          | Tagged fixture                                   | PASS for permission-allowed actions; DEGRADED existing-text refusal remains adjacent before commit                                                                            |
| Error notice                                                   | Attempt to open non-PDF bytes; dismiss                                                                                          | Invalid local bytes                              | DEFECT-FIXED — ordered alert has minimum width, visible Dismiss, and does not overlap another notice                                                                          |
| Loading notice                                                 | Start local open; Cancel                                                                                                        | Tagged fixture                                   | DEFECT-FIXED — progress remains a polite status and Cancel aborts the open controller                                                                                         |
| Recovery notice                                                | Seed OPFS recovery entry; Recover or Discard                                                                                    | Local recovery store                             | PASS — ordered status, explicit recovery, explicit discard                                                                                                                    |
| Password dialog                                                | Open E2E-generated AES-256 PDF; wrong password; retry; Escape                                                                   | qpdf-generated protected fixture                 | DEFECT-FIXED — focus is trapped and restored to Open document                                                                                                                 |
| Unsaved-change dialog                                          | Add note; choose another PDF; exercise Download, Discard, Cancel, and Escape                                                    | Tagged fixture then OCG fixture                  | DEFECT-FIXED — Radix dialog replaces `window.confirm`; Cancel receives initial focus                                                                                          |
| Organize result preview                                        | Select page; Extract, Split, Delete, Rotate, Merge, or label operation; Apply or Cancel                                         | `ghostscript.pdf`                                | PASS — no bulk or destructive operation mutates before the result preview                                                                                                     |
| Comments import/export preview                                 | Comments; Preview export/import; Download or Import/Cancel                                                                      | Tagged fixture                                   | PASS — preview states exact preserved/omitted counts                                                                                                                          |
| Forms authoring, test, validation, data, and script disclosure | Forms; Add a field; test; validate; export; open JavaScript disclosure                                                          | Tagged fixture                                   | PASS with the visible DEGRADED page-click limitation                                                                                                                          |
| Print permitted and excluded states                            | Print; choose range/subset/reverse; inspect disabled scale/content explanation; open the generated blob in a local print window | Multipage fixture                                | DEFECT-FIXED — unapplied settings are disabled with adjacent truthful copy and the real popup path is browser-driven                                                          |
| Reduced motion                                                 | Emulate `prefers-reduced-motion: reduce`; inspect resolved transition durations                                                 | Empty shell                                      | PASS — every resolved transition duration is `0s`                                                                                                                             |
| Forced colors                                                  | Emulate `forced-colors: active`; keyboard-focus Commands                                                                        | Empty shell                                      | PASS — focus outline resolves at two CSS px or more                                                                                                                           |
| 200% reflow                                                    | Browser zoom/reflow equivalent at 380 and 320 CSS px; open Commands by keyboard                                                 | Empty shell and tagged fixture                   | PASS — no horizontal document overflow or clipped visible control                                                                                                             |

The behavioural rows have direct captures at
`screenshots/ui-sweep/{long-title-narrow,active-redaction-tool,error-notice,password-dialog,unsaved-changes-dialog,forced-colors-focus,narrow-shell,designed-property-controls,concurrent-panels,shortcut-editor,keyboard-selection-actions,print-preparation}.png`.
Rows whose result is a focus return, cancellation, download, or persisted state additionally rely
on the named Playwright assertion because a still image cannot prove the transition.

## Independent output validation

The test `validates every reachable file-producing UI path with independent readers` runs in
Chromium and Firefox. Save, Organize extract, both split outputs, Protect encrypted output, and
Sanitize output are checked by qpdf; protected output is checked with its reader password.
Comment XFDF and form XFDF are parsed as XML, Markdown is checked for its document heading and
all nine page sections, and tool-set, shortcut, and automation-pipeline JSON are parsed and
checked through real browser download events. Attachment output remains fixture-blocked and OCR
text output remains platform-blocked when `TextDetector` is absent. MuPDF is never the acceptance
reader.

## Engine-blocked states

These rows are not counted as UI passes. The interface contract is recorded, but the current
engine does not provide the signal required to reach the state.

| State                                         | Parity scope           | Missing engine signal                                                            | Presentation contract                                                      |
| --------------------------------------------- | ---------------------- | -------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| XFA refusal                                   | `FORM-030`             | `DocumentInfo` does not report XFA and the corpus has no XFA fixture             | Forms must name XFA and refuse unsupported authoring before a user edits   |
| RC4 compatibility disclosure                  | `SIGN-024`             | `DocumentInfo.encryption` has no algorithm field and no RC4 fixture is committed | Password dialog or Protect must name RC4 compatibility before output       |
| Existing signed-document rewrite confirmation | `SIGN-035`             | No signed redistributable fixture reaches a nonzero signature count              | Every full rewrite must name the affected signature count before commit    |
| Permission-denied copy and print              | `FIND-014`, `PRNT-013` | No committed fixture denies those exact permissions                              | Disabled actions must name the document permission and a next step         |
| Populated embedded attachments                | `VIEW-022`             | No attachment-bearing fixture is committed                                       | Files must list name/type and expose a keyboard-operable local Save action |
