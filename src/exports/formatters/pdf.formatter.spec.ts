import { formatPdf } from './pdf.formatter';

describe('formatPdf', () => {
  it('should generate a PDF buffer', async () => {
    const columns = [
      { header: 'Name', key: 'name' },
      { header: 'Email', key: 'email' },
    ];
    const data = [{ name: 'Jane Doe', email: 'jane@example.com' }];

    const buffer = await formatPdf(data, columns, 'Members Export');

    expect(buffer).toBeInstanceOf(Buffer);
    expect(buffer.length).toBeGreaterThan(0);
    // PDF files start with %PDF
    expect(buffer.toString('ascii', 0, 4)).toBe('%PDF');
  });

  it('should handle empty data', async () => {
    const columns = [{ header: 'Name', key: 'name' }];

    const buffer = await formatPdf([], columns, 'Empty Export');

    expect(buffer).toBeInstanceOf(Buffer);
    expect(buffer.toString('ascii', 0, 4)).toBe('%PDF');
  });
});
