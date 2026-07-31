import * as mupdf from '../../../vendor/mupdf-wasm/dist/mupdf.js';
import { withArenaSync } from './arena';

export type AuthenticationRole = 'user' | 'owner';

export class DocumentAuthenticationError extends Error {
  constructor(
    readonly code:
      | 'password_required'
      | 'invalid_password'
      | 'owner_password_required'
      | 'permission_denied',
    message: string,
  ) {
    super(message);
    this.name = 'DocumentAuthenticationError';
  }
}

export function assertDocumentPermission(
  document: mupdf.Document,
  role: AuthenticationRole | null,
  permission: Parameters<mupdf.Document['hasPermission']>[0],
  action: string,
): void {
  if (role === 'owner' || document.hasPermission(permission)) return;
  throw new DocumentAuthenticationError(
    'permission_denied',
    `${action} is blocked by this PDF's permission settings. Authenticate its owner password in Protect to continue.`,
  );
}

export function assertEncryptionChangeAllowed(
  role: AuthenticationRole | null,
  encryption: 'keep' | 'none' | 'aes-128' | 'aes-256',
): void {
  if (role === 'user' && encryption !== 'keep') {
    throw new DocumentAuthenticationError(
      'owner_password_required',
      "Changing this PDF's password, permissions, or encryption requires its owner password. Authenticate the owner password in Protect and try again.",
    );
  }
}

export function authenticateDocument(
  document: mupdf.Document,
  password: string | undefined,
): AuthenticationRole | null {
  const encrypted =
    document instanceof mupdf.PDFDocument &&
    withArenaSync((arena) => {
      const trailer = arena.keep(document.getTrailer());
      return !arena.keep(trailer.get('Encrypt')).isNull();
    });
  if (!encrypted) return null;
  const requiresPassword = document.needsPassword();
  if (requiresPassword && password === undefined) {
    throw new DocumentAuthenticationError(
      'password_required',
      'This PDF is password-protected. Enter the document password to continue.',
    );
  }
  const permissions = document.authenticatePassword(password ?? '');
  if (permissions === 0) {
    throw new DocumentAuthenticationError(
      'invalid_password',
      'That password did not open this PDF. Check it and try again.',
    );
  }
  return permissions & 4 ? 'owner' : 'user';
}

export default {
  assertEncryptionChangeAllowed,
  assertDocumentPermission,
  authenticateDocument,
  DocumentAuthenticationError,
};
