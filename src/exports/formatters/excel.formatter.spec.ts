import { formatExcel } from './excel.formatter';
import * as ExcelJS from 'exceljs';

describe('formatExcel', () => {
  it('should generate xlsx buffer with headers and data', async () => {
    const columns = [
      { header: 'Name', key: 'name' },
      { header: 'Email', key: 'email' },
    ];
    const data = [{ name: 'Jane Doe', email: 'jane@example.com' }];

    const buffer = await formatExcel(data, columns, 'Members');

    // Parse the buffer back to verify contents
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer as unknown as ArrayBuffer);
    const worksheet = workbook.getWorksheet('Members')!;

    expect(worksheet).toBeDefined();
    expect(worksheet.getRow(1).getCell(1).value).toBe('Name');
    expect(worksheet.getRow(1).getCell(2).value).toBe('Email');
    expect(worksheet.getRow(2).getCell(1).value).toBe('Jane Doe');
    expect(worksheet.getRow(2).getCell(2).value).toBe('jane@example.com');
  });

  it('should handle empty data with headers only', async () => {
    const columns = [{ header: 'Name', key: 'name' }];

    const buffer = await formatExcel([], columns, 'Empty');

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer as unknown as ArrayBuffer);
    const worksheet = workbook.getWorksheet('Empty')!;

    expect(worksheet).toBeDefined();
    expect(worksheet.getRow(1).getCell(1).value).toBe('Name');
    expect(worksheet.rowCount).toBe(1);
  });
});
