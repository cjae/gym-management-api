import { formatCsv, sanitizeCsvCell } from './csv.formatter';

describe('sanitizeCsvCell', () => {
  it('prefixes a leading `=` with a single quote', () => {
    expect(sanitizeCsvCell('=SUM(A1:A2)')).toBe("'=SUM(A1:A2)");
  });

  it('prefixes a leading `+`', () => {
    expect(sanitizeCsvCell('+1-2')).toBe("'+1-2");
  });

  it('prefixes a leading `-`', () => {
    expect(sanitizeCsvCell('-5')).toBe("'-5");
  });

  it('prefixes a leading `@`', () => {
    expect(sanitizeCsvCell('@foo')).toBe("'@foo");
  });

  it('prefixes a leading tab', () => {
    expect(sanitizeCsvCell('\t=cmd')).toBe("'\t=cmd");
  });

  it('prefixes a leading carriage return', () => {
    expect(sanitizeCsvCell('\r=cmd')).toBe("'\r=cmd");
  });

  it('prefixes whitespace-then-formula (Excel still parses these)', () => {
    expect(sanitizeCsvCell(' =HYPERLINK("http://evil.com")')).toBe(
      '\' =HYPERLINK("http://evil.com")',
    );
  });

  it('leaves normal strings unchanged', () => {
    expect(sanitizeCsvCell('John Doe')).toBe('John Doe');
  });

  it('leaves strings with internal formula chars unchanged', () => {
    expect(sanitizeCsvCell('john+doe@example.com')).toBe(
      'john+doe@example.com',
    );
  });

  it('returns empty string for null', () => {
    expect(sanitizeCsvCell(null)).toBe('');
  });

  it('returns empty string for undefined', () => {
    expect(sanitizeCsvCell(undefined)).toBe('');
  });

  it('returns empty string for empty input without crashing', () => {
    expect(sanitizeCsvCell('')).toBe('');
  });
});

describe('formatCsv', () => {
  it('should generate CSV with headers and rows', async () => {
    const columns = [
      { header: 'Name', key: 'name' },
      { header: 'Email', key: 'email' },
    ];
    const data = [
      { name: 'Jane Doe', email: 'jane@example.com' },
      { name: 'John Smith', email: 'john@example.com' },
    ];

    const buffer = await formatCsv(data, columns);
    const csv = buffer.toString();

    expect(csv).toContain('Name,Email');
    expect(csv).toContain('Jane Doe,jane@example.com');
    expect(csv).toContain('John Smith,john@example.com');
  });

  it('should handle empty data', async () => {
    const columns = [{ header: 'Name', key: 'name' }];

    const buffer = await formatCsv([], columns);
    const csv = buffer.toString();

    expect(csv).toContain('Name');
    const lines = csv.trim().split('\n');
    expect(lines).toHaveLength(1);
  });

  it('should handle null and undefined values', async () => {
    const columns = [
      { header: 'Name', key: 'name' },
      { header: 'Phone', key: 'phone' },
    ];
    const data = [
      { name: 'Jane', phone: null },
      { name: 'John', phone: undefined },
    ];

    const buffer = await formatCsv(data, columns);
    const csv = buffer.toString();

    expect(csv).toContain('Jane');
    expect(csv).toContain('John');
  });

  it('should sanitize values starting with formula characters', async () => {
    const columns = [{ header: 'Name', key: 'name' }];
    const data = [
      { name: '=HYPERLINK("http://evil.com")' },
      { name: '+cmd' },
      { name: '-malicious' },
      { name: '@SUM(A1)' },
    ];

    const buffer = await formatCsv(data, columns);
    const csv = buffer.toString();

    expect(csv).toContain("'=HYPERLINK");
    expect(csv).toContain("'+cmd");
    expect(csv).toContain("'-malicious");
    expect(csv).toContain("'@SUM");
  });

  it('should sanitize whitespace-prefixed formula characters', async () => {
    const columns = [{ header: 'Name', key: 'name' }];
    const data = [
      { name: ' =HYPERLINK("http://evil.com")' },
      { name: '\t=cmd' },
      { name: '\r=malicious' },
    ];

    const buffer = await formatCsv(data, columns);
    const csv = buffer.toString();

    expect(csv).toContain("' =HYPERLINK");
    expect(csv).toContain("'\t=cmd");
    expect(csv).toContain("'\r=malicious");
  });

  it('should not alter numeric cell values', async () => {
    const columns = [{ header: 'Amount', key: 'amount' }];
    const data = [{ amount: 5000 }];

    const buffer = await formatCsv(data, columns);
    const csv = buffer.toString();

    expect(csv).toContain('5000');
  });
});
