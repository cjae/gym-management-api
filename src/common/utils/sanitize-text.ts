export const sanitizeText = (s: string): string =>
  s.replace(/[\r\n\t]/g, ' ').trim();
