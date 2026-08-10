export const COLOR_CHOICES = [
  ['color-choice-ink', 'Ink'],
  ['color-choice-accent', 'Accent'],
  ['color-choice-danger', 'Danger'],
  ['color-choice-warning', 'Warning'],
  ['color-choice-positive', 'Positive'],
  ['color-choice-paper', 'Paper'],
] as const;

export type SemanticColorToken =
  (typeof COLOR_CHOICES)[number][0] | 'annotation-stroke' | 'annotation-fill';

const FALLBACK_COLORS: Readonly<Record<SemanticColorToken, string>> = {
  'annotation-fill': '#eef1ff',
  'annotation-stroke': '#3853d8',
  'color-choice-accent': '#3853d8',
  'color-choice-danger': '#b4232b',
  'color-choice-ink': '#15181d',
  'color-choice-paper': '#ffffff',
  'color-choice-positive': '#176b43',
  'color-choice-warning': '#7a4d00',
};

export function semanticColorValue(token: SemanticColorToken): string {
  const probe = document.createElement('span');
  probe.style.color = `var(--${token})`;
  document.body.append(probe);
  const channels = (getComputedStyle(probe).color.match(/\d+/g) ?? []).map(Number);
  probe.remove();
  return channels.length === 3
    ? `#${channels.map((channel) => channel.toString(16).padStart(2, '0')).join('')}`
    : FALLBACK_COLORS[token];
}
