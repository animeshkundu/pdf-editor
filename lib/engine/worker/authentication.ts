import * as mupdf from '../../../vendor/mupdf-wasm/dist/mupdf.js';
import { withArenaSync } from './arena';
import { inspectDocumentEncryption, type DocumentEncryptionSecurity } from './security';

export type AuthenticationRole = 'user' | 'owner';
export interface DocumentAuthentication {
  readonly role: AuthenticationRole | null;
  readonly encryption: DocumentEncryptionSecurity;
}

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

export function authenticateDocumentWithSecurity(
  document: mupdf.Document,
  password: string | undefined,
): DocumentAuthentication {
  const role = authenticateDocument(document, password);
  if (!(document instanceof mupdf.PDFDocument)) {
    return {
      role,
      encryption: {
        protected: false,
        algorithm: 'none',
        version: null,
        revision: null,
        readOnly: false,
      },
    };
  }
  return { role, encryption: inspectDocumentEncryption(document) };
}

export default {
  assertEncryptionChangeAllowed,
  assertDocumentPermission,
  authenticateDocument,
  authenticateDocumentWithSecurity,
  DocumentAuthenticationError,
};
