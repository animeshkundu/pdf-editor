import * as mupdf from '../../../vendor/mupdf-wasm/dist/mupdf.js';
import { assertSaveFlags } from '../../core/limits';
import type { EngineTypes } from '../port';
import { withArenaSync, type Arena } from './arena';

const PERMISSION_BITS: Record<EngineTypes['PdfPermission'], number> = {
  print: 1 << 2,
  edit: 1 << 3,
  copy: 1 << 4,
  annotate: 1 << 5,
  form: 1 << 8,
  accessibility: 1 << 9,
  assemble: 1 << 10,
  'print-hq': 1 << 11,
};

function permissionMask(
  permissions: readonly EngineTypes['PdfPermission'][] | undefined,
): number {
  if (!permissions) return -1;
  return permissions.reduce((mask, permission) => mask | PERMISSION_BITS[permission], 0);
}

function assertPassword(name: string, value: string | undefined): void {
  if (value === undefined) return;
  const bytes = new TextEncoder().encode(value).byteLength;
  if (bytes > 127) throw new Error(`${name} must be at most 127 UTF-8 bytes.`);
  if (value.includes(',') || value.includes('\0')) {
    throw new Error(`${name} cannot contain a comma or a null character.`);
  }
}

function writeOptions(
  options: EngineTypes['SaveOptions'],
): Record<string, string | number | boolean> {
  assertPassword('The user password', options['user-password']);
  assertPassword('The owner password', options['owner-password']);
  const result: Record<string, string | number | boolean> = {
    compress: options.compress,
  };
  if (options.mode === 'incremental') result.incremental = true;
  if (options.garbage !== 'none') {
    result.garbage = options.garbage === 'all' ? 4 : options.garbage;
  }
  if (options.encrypt === 'none') {
    result.encrypt = 'none';
  } else if (options.encrypt !== 'keep') {
    result.encrypt = options.encrypt;
    result['user-password'] = options['user-password'] ?? '';
    result['owner-password'] = options['owner-password'] ?? '';
    result.permissions = permissionMask(options.permissions);
  }
  return result;
}

function saveWithArena(
  arena: Arena,
  document: mupdf.PDFDocument,
  options: EngineTypes['SaveOptions'],
): ArrayBuffer {
  assertSaveFlags(
    {
      mode: options.mode,
      garbage: options.garbage,
      changesEncryption: options.encrypt !== 'keep',
    },
    {
      canIncremental: document.canBeSavedIncrementally(),
      wasRepaired: document.wasRepaired(),
    },
  );
  let target = document;
  if (options.mode === 'full') {
    const staged = arena.keep(
      document.saveToBuffer({ compress: true, 'regenerate-id': false }),
    );
    const isolated = arena.keep(
      mupdf.Document.openDocument(Uint8Array.from(staged.asUint8Array()), 'application/pdf'),
    );
    if (!(isolated instanceof mupdf.PDFDocument)) {
      throw new Error('The isolated save snapshot is not a PDF document.');
    }
    target = isolated;
  }
  const buffer = arena.keep(target.saveToBuffer(writeOptions(options)));
  return Uint8Array.from(buffer.asUint8Array()).buffer;
}

export function saveDocument(
  document: mupdf.PDFDocument,
  options: EngineTypes['SaveOptions'],
): ArrayBuffer {
  return withArenaSync((arena) => saveWithArena(arena, document, options));
}

export function snapshotDocument(document: mupdf.PDFDocument): Uint8Array {
  const data = saveDocument(document, {
    mode: 'full',
    garbage: 'none',
    compress: true,
    encrypt: 'keep',
  });
  return new Uint8Array(data);
}

export function persistenceSnapshot(document: mupdf.PDFDocument): Uint8Array {
  const data = saveDocument(document, {
    mode: 'full',
    // Recovery files are durable. Collect unreachable objects so applied redactions cannot
    // leave their replaced content streams recoverable in OPFS.
    garbage: 'deduplicate',
    compress: true,
    encrypt: 'keep',
  });
  return new Uint8Array(data);
}

export const SAFE_FULL_SAVE: EngineTypes['SaveOptions'] = {
  mode: 'full',
  garbage: 'deduplicate',
  compress: true,
  encrypt: 'keep',
};

export default { persistenceSnapshot, SAFE_FULL_SAVE, saveDocument, snapshotDocument };
