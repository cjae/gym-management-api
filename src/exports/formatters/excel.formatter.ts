import * as ExcelJS from 'exceljs';
import { ExportColumn, sanitizeCsvCell } from './csv.formatter';

export async function formatExcel(
  data: Record<string, any>[],
  columns: ExportColumn[],
  sheetName: string,
): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet(sheetName);

  worksheet.columns = columns.map((col) => ({
    header: col.header,
    key: col.key,
    width: col.header.length + 2,
  }));

  // Bold header row
  worksheet.getRow(1).font = { bold: true };

  for (const row of data) {
    const values: Record<string, any> = {};
    for (const col of columns) {
      const val = row[col.key];
      // Formula injection works identically in xlsx — if a cell's string
      // value starts with `=`, `+`, `-`, `@`, tab, or CR, Excel will parse
      // it as a formula on open. Sanitize free text the same way we do for
      // CSV. Numbers/booleans/dates flow through untouched.
      if (typeof val === 'string' || val === null || val === undefined) {
        values[col.key] = sanitizeCsvCell(val);
      } else {
        values[col.key] = val;
      }
    }
    worksheet.addRow(values);
  }

  // Auto-fit column widths based on content
  worksheet.columns.forEach((column) => {
    let maxLength = column.header ? String(column.header).length : 10;
    column.eachCell?.({ includeEmpty: false }, (cell) => {
      const cellValue = cell.value;
      const cellLength =
        cellValue !== null && cellValue !== undefined
          ? String(cellValue as string).length
          : 0;
      if (cellLength > maxLength) maxLength = cellLength;
    });
    column.width = Math.min(maxLength + 2, 50);
  });

  const arrayBuffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(arrayBuffer);
}
