import { formatCsv } from './csv.formatter';

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
    const data = [{ name: 'Jane', phone: null }];

    const buffer = await formatCsv(data, columns);
    const csv = buffer.toString();

    expect(csv).toContain('Jane');
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
});
