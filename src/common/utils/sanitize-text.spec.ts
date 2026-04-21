import { sanitizeText } from './sanitize-text';

describe('sanitizeText', () => {
  it('replaces \\n, \\r, and \\t with single spaces', () => {
    expect(sanitizeText('a\nb\rc\td')).toBe('a b c d');
  });

  it('trims leading and trailing whitespace', () => {
    expect(sanitizeText('   hello   ')).toBe('hello');
  });

  it('trims after collapsing boundary newlines and tabs', () => {
    expect(sanitizeText('\n\tShoulder pain\r\n')).toBe('Shoulder pain');
  });

  it('preserves interior single spaces between words', () => {
    expect(sanitizeText('mild lower back pain')).toBe('mild lower back pain');
  });

  it('preserves multiple interior spaces verbatim', () => {
    expect(sanitizeText('double  space  here')).toBe('double  space  here');
  });

  it('returns empty string for whitespace-only input', () => {
    expect(sanitizeText('\r\n\t  ')).toBe('');
  });

  it('returns empty string for empty input', () => {
    expect(sanitizeText('')).toBe('');
  });
});
