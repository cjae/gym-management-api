// Strips line-break-equivalent characters that would let a member's free-form
// text (injury notes, goal titles) break out of its single line inside the LLM
// prompt and inject new instructions. Keeps regular interior spaces intact.
const LINE_BREAK_EQUIVALENTS = /[\r\n\t\v\f\u0085\u2028\u2029]/g;
// eslint-disable-next-line no-control-regex -- stripping control chars is the purpose of this util
const CONTROL_CHARS = /[\x00-\x08\x0E-\x1F\x7F]/g;

export const sanitizeText = (s: string): string =>
  s.replace(LINE_BREAK_EQUIVALENTS, ' ').replace(CONTROL_CHARS, '').trim();
