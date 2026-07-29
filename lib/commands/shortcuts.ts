export interface PlatformNavigator {
  readonly platform?: string;
  readonly userAgent?: string;
}

export function isMacPlatform(
  nav: PlatformNavigator = typeof navigator === 'undefined' ? {} : navigator,
): boolean {
  return /Mac|iPhone|iPad|iPod/.test(`${nav.platform ?? ''} ${nav.userAgent ?? ''}`);
}

export function formatShortcut(
  shortcut: string,
  nav: PlatformNavigator = typeof navigator === 'undefined' ? {} : navigator,
): string {
  const modifier = isMacPlatform(nav) ? '⌘' : 'Ctrl';
  return shortcut.replace(/\bMod\b/g, modifier).replaceAll('+', ' ');
}

export function isTextEntryTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target.isContentEditable ||
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target.getAttribute('role') === 'textbox'
  );
}

export function matchesShortcut(
  event: KeyboardEvent,
  shortcut: string,
  nav: PlatformNavigator = typeof navigator === 'undefined' ? {} : navigator,
): boolean {
  const normalized = shortcut.replace(/\+\+$/, '+Plus');
  const tokens = normalized.split('+');
  const key = tokens[tokens.length - 1];
  const needsModifier = tokens.includes('Mod');
  const modifier = isMacPlatform(nav) ? event.metaKey : event.ctrlKey;
  if (needsModifier !== modifier) return false;
  if (tokens.includes('Shift') !== event.shiftKey) return false;
  if (tokens.includes('Alt') !== event.altKey) return false;
  if (!needsModifier && (event.ctrlKey || event.metaKey)) return false;
  if (key === 'Plus') return event.key === '+' || event.key === '=';
  return event.key.toLocaleLowerCase() === key?.toLocaleLowerCase();
}

export default { formatShortcut, isMacPlatform, isTextEntryTarget, matchesShortcut };
