import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import * as mupdf from '../vendor/mupdf-wasm/dist/mupdf.js';
import { withArenaSync } from '../lib/engine/worker/arena';
import formMutations from '../lib/engine/worker/mutations/forms';
import { journalOperation, journalState } from '../lib/engine/worker/mutations/transaction';
import { saveDocument, SAFE_FULL_SAVE } from '../lib/engine/worker/save';

const workDir = mkdtempSync(join(tmpdir(), 'pdf-editor-forms-'));
let qpdf = '';

function createDocument(events: mupdf.PDFJSEvent[] = []): mupdf.PDFDocument {
  const document = new mupdf.PDFDocument();
  const page = document.addPage([0, 0, 612, 792], 0, null, new Uint8Array(0));
  try {
    document.insertPage(-1, page);
  } finally {
    page.destroy();
  }
  document.setJSEventListener((event) => events.push(event));
  document.enableJS();
  expect(document.isJSSupported()).toBe(true);
  document.enableJournal();
  return document;
}

function expectQpdfAccepts(data: ArrayBuffer, name: string): void {
  const path = join(workDir, name);
  writeFileSync(path, new Uint8Array(data));
  const result = spawnSync(qpdf, ['--check', path], { encoding: 'utf8', shell: false });
  expect(result.status, result.stderr || result.stdout).toBe(0);
}

function qpdfJson(data: ArrayBuffer, name: string): string {
  const path = join(workDir, name);
  writeFileSync(path, new Uint8Array(data));
  const result = spawnSync(qpdf, ['--json', '--json-stream-data=none', path], {
    encoding: 'utf8',
    shell: false,
  });
  expect(result.status, result.stderr || result.stdout).toBe(0);
  return result.stdout;
}

async function pdfJsFields(data: ArrayBuffer) {
  const task = getDocument({ data: new Uint8Array(data.slice(0)) });
  const document = await task.promise;
  try {
    return await document.getFieldObjects();
  } finally {
    await task.destroy();
  }
}

async function pdfJsAnnotations(data: ArrayBuffer) {
  const task = getDocument({
    data: new Uint8Array(data.slice(0)),
    useSystemFonts: false,
  });
  const document = await task.promise;
  try {
    const page = await document.getPage(1);
    return await page.getAnnotations();
  } finally {
    await task.destroy();
  }
}

async function pdfJsActions(data: ArrayBuffer) {
  const task = getDocument({ data: new Uint8Array(data.slice(0)) });
  const document = await task.promise;
  try {
    return await document.getJSActions();
  } finally {
    await task.destroy();
  }
}

beforeAll(() => {
  const setup = spawnSync(process.execPath, ['scripts/setup-qpdf.mjs', '--print-path'], {
    encoding: 'utf8',
    shell: false,
  });
  if (setup.status !== 0) throw new Error(setup.stderr || setup.stdout);
  qpdf = setup.stdout.trim();
});

afterAll(() => rmSync(workDir, { recursive: true, force: true }));

describe('FORM-001/FORM-009/FORM-022 AcroForm oracle', () => {
  it('creates a standards-visible text field and fills it in one journal step per action', async () => {
    const document = createDocument();
    try {
      journalOperation(
        document,
        'Create text field',
        () => undefined,
        (arena) =>
          formMutations.createFormField(arena, document, {
            pageIndex: 0,
            name: 'full_name',
            label: 'Full name',
            type: 'text',
            rect: [72, 650, 300, 682],
            required: true,
          }),
      );
      expect(journalState(document)).toMatchObject({
        position: 1,
        steps: ['Create text field'],
      });

      await (async () => {
        const events: mupdf.PDFJSEvent[] = [];
        const document = createDocument(events);
        try {
          journalOperation(
            document,
            'Create scripted fields',
            () => undefined,
            (arena) => {
              formMutations.createFormField(arena, document, {
                pageIndex: 0,
                name: 'amount',
                type: 'text',
                rect: [72, 650, 200, 682],
              });
              formMutations.createFormField(arena, document, {
                pageIndex: 0,
                name: 'double_amount',
                type: 'text',
                rect: [220, 650, 360, 682],
                readOnly: true,
              });
            },
          );
          journalOperation(
            document,
            'Author form scripts',
            () => undefined,
            (arena) => {
              formMutations.setJavaScriptAction(arena, document, {
                scope: 'field',
                name: 'amount',
                trigger: 'keystroke',
                source: 'event.change = event.change.toUpperCase();',
              });
              formMutations.setJavaScriptAction(arena, document, {
                scope: 'field',
                name: 'amount',
                trigger: 'validate',
                source: 'event.rc = event.value !== "BLOCKED";',
              });
              formMutations.setJavaScriptAction(arena, document, {
                scope: 'field',
                name: 'double_amount',
                trigger: 'calculate',
                source: 'event.value = Number(this.getField("amount").value) * 2;',
              });
              formMutations.setJavaScriptAction(arena, document, {
                scope: 'document',
                name: 'Document calculations',
                source: 'global.documentReady = true;',
              });
              formMutations.setJavaScriptAction(arena, document, {
                scope: 'document',
                name: 'a',
                source: 'global.lowercase = true;',
              });
              formMutations.setJavaScriptAction(arena, document, {
                scope: 'document',
                name: 'B',
                source: 'global.uppercase = true;',
              });
            },
          );

          const scripts = formMutations.listJavaScriptActions(document);
          expect(
            scripts
              .filter((script) => script.scope === 'document')
              .map((script) => script.name),
          ).toEqual(['B', 'Document calculations', 'a']);
          expect(scripts.filter((script) => script.scope === 'field')).toMatchObject([
            { scope: 'field', fieldName: 'amount', trigger: 'keystroke' },
            { scope: 'field', fieldName: 'amount', trigger: 'validate' },
            { scope: 'field', fieldName: 'double_amount', trigger: 'calculate' },
          ]);
          expect(() =>
            journalOperation(
              document,
              'Reject invalid value',
              () => undefined,
              (arena) => formMutations.setFieldValue(arena, document, 'amount', 'blocked'),
            ),
          ).toThrow('rejected');
          expect(journalState(document).steps).toEqual([
            'Create scripted fields',
            'Author form scripts',
          ]);

          journalOperation(
            document,
            'Fill scripted field',
            () => undefined,
            (arena) => formMutations.setFieldValue(arena, document, 'amount', '21'),
          );
          expect(formMutations.listFields(document)).toMatchObject([
            { name: 'amount', value: '21' },
            { name: 'double_amount', value: '42' },
          ]);

          expect(
            document.executeJS(
              'console.println("worker only"); app.launchURL("https://blocked.example", true); 6 * 7;',
            ),
          ).toBe('42');
          expect(events).toEqual(
            expect.arrayContaining([
              expect.objectContaining({ type: 'console', action: 'write' }),
              expect.objectContaining({ type: 'launch-url', url: 'https://blocked.example' }),
            ]),
          );

          const output = saveDocument(document, SAFE_FULL_SAVE);
          expectQpdfAccepts(output, 'scripted-form.pdf');
          const json = qpdfJson(output, 'scripted-form-json.pdf');
          expect(json).toContain('Document calculations');
          expect(json).toContain('double_amount');
          expect(json).toContain('event.rc');
          expect(json).toContain('event.value');
          expect(await pdfJsActions(output)).toMatchObject({
            B: ['global.uppercase = true;'],
            'Document calculations': ['global.documentReady = true;'],
            a: ['global.lowercase = true;'],
          });
          expect(await pdfJsFields(output)).toMatchObject({
            amount: [expect.objectContaining({ value: '21' })],
            double_amount: [expect.objectContaining({ value: '42' })],
          });
        } finally {
          document.destroy();
        }
      })();
      expect(formMutations.listFields(document)).toMatchObject([
        {
          name: 'full_name',
          label: 'Full name',
          type: 'text',
          required: true,
        },
      ]);

      journalOperation(
        document,
        'Import form data',
        () => undefined,
        (arena) =>
          formMutations.setFieldValues(arena, document, {
            full_name: 'Ada Lovelace',
          }),
      );
      expect(journalState(document)).toMatchObject({
        position: 2,
        steps: ['Create text field', 'Import form data'],
      });

      const output = saveDocument(document, SAFE_FULL_SAVE);
      expectQpdfAccepts(output, 'authored-form.pdf');
      const fields = await pdfJsFields(output);
      expect(fields?.full_name?.[0]).toMatchObject({
        name: 'full_name',
        value: 'Ada Lovelace',
        type: 'text',
      });
      const formJson = qpdfJson(output, 'authored-form-resources.pdf');
      expect(formJson).toContain('"/DR"');
      expect(formJson).toContain('"/Helv"');
      expect(formJson).toContain('"/BaseFont": "/Helvetica"');
      expect(formJson).toContain('"/Encoding": "/WinAnsiEncoding"');
      const annotations = await pdfJsAnnotations(output);
      expect(annotations).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            fieldName: 'full_name',
            defaultAppearanceData: expect.objectContaining({
              fontName: 'Helv',
              fontSize: 12,
            }),
          }),
        ]),
      );

      document.undo();
      expect(formMutations.listFields(document)[0]?.value).toBe('');
    } finally {
      document.destroy();
    }
  });

  it('abandons duplicate-name authoring without adding a history step', () => {
    const document = createDocument();
    try {
      journalOperation(
        document,
        'Create text field',
        () => undefined,
        (arena) =>
          formMutations.createFormField(arena, document, {
            pageIndex: 0,
            name: 'unique_name',
            type: 'text',
            rect: [72, 650, 300, 682],
          }),
      );
      expect(() =>
        journalOperation(
          document,
          'Create duplicate field',
          () => undefined,
          (arena) =>
            formMutations.createFormField(arena, document, {
              pageIndex: 0,
              name: 'unique_name',
              type: 'checkbox',
              rect: [72, 600, 100, 628],
            }),
        ),
      ).toThrow('already exists');
      expect(journalState(document)).toMatchObject({
        position: 1,
        steps: ['Create text field'],
      });
      expect(formMutations.listFields(document)).toHaveLength(1);
    } finally {
      document.destroy();
    }
  });

  it('stores one calculation-order entry for a field with multiple widgets', () => {
    const document = createDocument();
    try {
      journalOperation(
        document,
        'Create multi-widget field',
        () => undefined,
        (arena) => {
          formMutations.createFormField(arena, document, {
            pageIndex: 0,
            name: 'shared_total',
            type: 'text',
            rect: [72, 650, 200, 682],
          });
          const page = arena.keep(document.loadPage(0));
          const first = arena.keep(page.getWidgets()[0]!);
          const firstObject = arena.keep(first.getObject());
          const parent = arena.keep(document.newDictionary());
          for (const key of ['FT', 'T', 'TU', 'Ff', 'V', 'DV', 'DA']) {
            const value = arena.keep(firstObject.get(key));
            if (!value.isNull()) arena.keep(parent.put(key, value));
            firstObject.delete(key);
          }
          const parentReference = arena.keep(document.addObject(parent));
          arena.keep(firstObject.put('Parent', parentReference));

          const second = arena.keep(page.createAnnotation('Widget'));
          const secondObject = arena.keep(second.getObject());
          arena.keep(secondObject.put('Parent', parentReference));
          second.setRect([220, 650, 360, 682]);
          second.update();

          const kids = arena.keep(document.newArray());
          arena.keep(kids.push(firstObject));
          arena.keep(kids.push(secondObject));
          arena.keep(parent.put('Kids', kids));

          const group = arena.keep(document.newDictionary());
          const groupName = arena.keep(document.newString('group'));
          arena.keep(group.put('T', groupName));
          const groupReference = arena.keep(document.addObject(group));
          arena.keep(parent.put('Parent', groupReference));
          const groupKids = arena.keep(document.newArray());
          arena.keep(groupKids.push(parentReference));
          arena.keep(group.put('Kids', groupKids));

          const trailer = arena.keep(document.getTrailer());
          const form = arena.keep(trailer.get('Root', 'AcroForm'));
          const customAppearance = arena.keep(document.newString('/Custom 9 Tf 1 0 0 rg'));
          arena.keep(form.put('DA', customAppearance));
          arena.keep(form.put('NeedAppearances', false));
          const fields = arena.keep(form.get('Fields'));
          arena.keep(fields.put(0, groupReference));
          page.update();
        },
      );

      journalOperation(
        document,
        'Add shared calculation',
        () => undefined,
        (arena) =>
          formMutations.setJavaScriptAction(arena, document, {
            scope: 'field',
            name: 'group.shared_total',
            trigger: 'calculate',
            source: 'event.value = 1;',
          }),
      );

      const order = withArenaSync((arena) => {
        const trailer = arena.keep(document.getTrailer());
        const form = arena.keep(trailer.get('Root', 'AcroForm'));
        const fields = arena.keep(form.get('Fields'));
        const group = arena.keep(fields.get(0));
        const terminal = arena.keep(group.get('Kids', 0));
        const calculationOrder = arena.keep(trailer.get('Root', 'AcroForm', 'CO'));
        const calculated = arena.keep(calculationOrder.get(0));
        return {
          count: calculationOrder.length,
          terminal: terminal.asIndirect(),
          calculated: calculated.asIndirect(),
          groupHasActions: !arena.keep(group.get('AA')).isNull(),
          defaultAppearance: arena.keep(form.get('DA')).asString(),
          needAppearances: arena.keep(form.get('NeedAppearances')).asBoolean(),
        };
      });
      expect(order).toMatchObject({
        count: 1,
        groupHasActions: false,
        defaultAppearance: '/Custom 9 Tf 1 0 0 rg',
        needAppearances: false,
      });
      expect(order.calculated).toBe(order.terminal);
    } finally {
      document.destroy();
    }
  });

  it('keeps document-open script mutations in one undoable journal operation', () => {
    const source = createDocument();
    let bytes: ArrayBuffer;
    try {
      journalOperation(
        source,
        'Create startup form',
        () => undefined,
        (arena) => {
          formMutations.createFormField(arena, source, {
            pageIndex: 0,
            name: 'startup_value',
            type: 'text',
            rect: [72, 650, 300, 682],
          });
          formMutations.setJavaScriptAction(arena, source, {
            scope: 'document',
            name: 'Startup values',
            source:
              'console.println("startup"); this.getField("startup_value").value = "opened"; ' +
              'app.launchURL("https://blocked.example", true);',
          });
        },
      );
      bytes = saveDocument(source, SAFE_FULL_SAVE);
    } finally {
      source.destroy();
    }

    const opened = mupdf.Document.openDocument(new Uint8Array(bytes), 'application/pdf');
    expect(opened).toBeInstanceOf(mupdf.PDFDocument);
    const document = opened as mupdf.PDFDocument;
    const events: mupdf.PDFJSEvent[] = [];
    try {
      document.setJSEventListener((event) => events.push(event));
      document.enableJournal();
      document.beginOperation('Run document JavaScript');
      try {
        document.enableJS();
        document.endOperation();
      } catch (error) {
        document.abandonOperation();
        throw error;
      }
      expect(formMutations.listFields(document)[0]?.value).toBe('opened');
      expect(document.getJournal()).toMatchObject({
        position: 1,
        steps: ['Run document JavaScript'],
      });
      expect(events).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ type: 'console', action: 'write', message: 'startup' }),
          expect.objectContaining({ type: 'launch-url', url: 'https://blocked.example' }),
        ]),
      );
      document.undo();
      expect(formMutations.listFields(document)[0]?.value).toBe('');
    } finally {
      document.destroy();
    }
  });

  it('refuses oversized decoded JavaScript before MuJS parses it', () => {
    const source = createDocument();
    let bytes: ArrayBuffer;
    try {
      journalOperation(
        source,
        'Create oversized script',
        () => undefined,
        (arena) => {
          formMutations.setJavaScriptAction(arena, source, {
            scope: 'document',
            name: 'Oversized',
            source: '0;',
          });
          const trailer = arena.keep(source.getTrailer());
          const names = arena.keep(trailer.get('Root', 'Names', 'JavaScript', 'Names'));
          const action = arena.keep(names.get(1));
          const dictionary = arena.keep(source.newDictionary());
          const stream = arena.keep(
            source.addStream(new Uint8Array(4 * 1024 * 1024 + 1).fill(0x20), dictionary),
          );
          arena.keep(action.put('JS', stream));
        },
      );
      bytes = saveDocument(source, SAFE_FULL_SAVE);
    } finally {
      source.destroy();
    }

    const opened = mupdf.Document.openDocument(new Uint8Array(bytes), 'application/pdf');
    expect(opened).toBeInstanceOf(mupdf.PDFDocument);
    const document = opened as mupdf.PDFDocument;
    try {
      document.setJSEventListener(() => undefined);
      expect(() => document.enableJS()).toThrow('decoded PDF string exceeds local limit');
    } finally {
      document.destroy();
    }
  });
});
