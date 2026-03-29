import * as ExcelJS from 'exceljs';
import { ExportColumn } from './csv.formatter';

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
    width: 20,
  }));

  // Bold header row
  worksheet.getRow(1).font = { bold: true };

  for (const row of data) {
    const values: Record<string, any> = {};
    for (const col of columns) {
      const val = row[col.key];
      values[col.key] = val === null || val === undefined ? '' : val;
    }
    worksheet.addRow(values);
  }

  const arrayBuffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(arrayBuffer);
}
