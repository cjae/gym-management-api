import PDFDocument from 'pdfkit';
import { ExportColumn } from './csv.formatter';

export async function formatPdf(
  data: Record<string, any>[],
  columns: ExportColumn[],
  title: string,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ layout: 'landscape', margin: 30 });
    const chunks: Buffer[] = [];

    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', (err: Error) => reject(err));

    // Title
    doc.fontSize(16).font('Helvetica-Bold').text(title, { align: 'center' });
    doc
      .fontSize(10)
      .font('Helvetica')
      .text(`Generated: ${new Date().toLocaleDateString()}`, {
        align: 'center',
      });
    doc.moveDown();

    if (data.length === 0) {
      doc.fontSize(12).text('No data to display.', { align: 'center' });
      doc.end();
      return;
    }

    // Calculate column widths
    const pageWidth =
      doc.page.width - doc.page.margins.left - doc.page.margins.right;
    const colWidth = pageWidth / columns.length;
    const startX = doc.page.margins.left;
    let y = doc.y;

    // Header row
    doc.font('Helvetica-Bold').fontSize(9);
    columns.forEach((col, i) => {
      doc.text(col.header, startX + i * colWidth, y, {
        width: colWidth,
        align: 'left',
      });
    });
    y += 18;
    doc
      .moveTo(startX, y)
      .lineTo(startX + pageWidth, y)
      .stroke();
    y += 5;

    // Data rows
    doc.font('Helvetica').fontSize(8);
    for (const row of data) {
      // Check if we need a new page
      if (y > doc.page.height - doc.page.margins.bottom - 20) {
        doc.addPage();
        y = doc.page.margins.top;
      }

      columns.forEach((col, i) => {
        const val = row[col.key];
        const text = val === null || val === undefined ? '' : String(val);
        doc.text(text, startX + i * colWidth, y, {
          width: colWidth,
          align: 'left',
        });
      });
      y += 15;
    }

    doc.end();
  });
}
