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

  it('should neutralize formula-injection payloads in string cells', async () => {
    const columns = [{ header: 'Name', key: 'name' }];
    const data = [
      { name: '=SUM(A1:A2)' },
      { name: '+1-2' },
      { name: '-5' },
      { name: '@foo' },
      { name: '\t=cmd' },
      { name: '\r=cmd' },
    ];

    const buffer = await formatExcel(data, columns, 'Members');

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer as unknown as ArrayBuffer);
    const worksheet = workbook.getWorksheet('Members')!;

    expect(worksheet.getRow(2).getCell(1).value).toBe("'=SUM(A1:A2)");
    expect(worksheet.getRow(3).getCell(1).value).toBe("'+1-2");
    expect(worksheet.getRow(4).getCell(1).value).toBe("'-5");
    expect(worksheet.getRow(5).getCell(1).value).toBe("'@foo");
    expect(worksheet.getRow(6).getCell(1).value).toBe("'\t=cmd");
    // Note: exceljs/xlsx normalizes the CR character to LF on round-trip,
    // but crucially the leading `'` prefix is preserved — which is what
    // prevents Excel from parsing the cell as a formula.
    const crCell = worksheet.getRow(7).getCell(1).value as string;
    expect(crCell.startsWith("'")).toBe(true);
    expect(crCell).toContain('=cmd');
  });

  it('should leave safe strings untouched', async () => {
    const columns = [
      { header: 'Name', key: 'name' },
      { header: 'Email', key: 'email' },
    ];
    const data = [{ name: 'John Doe', email: 'john+doe@example.com' }];

    const buffer = await formatExcel(data, columns, 'Members');

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer as unknown as ArrayBuffer);
    const worksheet = workbook.getWorksheet('Members')!;

    expect(worksheet.getRow(2).getCell(1).value).toBe('John Doe');
    expect(worksheet.getRow(2).getCell(2).value).toBe('john+doe@example.com');
  });

  it('should handle null/undefined without crashing', async () => {
    const columns = [
      { header: 'Name', key: 'name' },
      { header: 'Phone', key: 'phone' },
    ];
    const data = [
      { name: 'Jane', phone: null },
      { name: 'John', phone: undefined },
    ];

    const buffer = await formatExcel(data, columns, 'Members');

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer as unknown as ArrayBuffer);
    const worksheet = workbook.getWorksheet('Members')!;

    expect(worksheet.getRow(2).getCell(1).value).toBe('Jane');
    expect(worksheet.getRow(3).getCell(1).value).toBe('John');
  });

  it('should not alter numeric cells', async () => {
    const columns = [
      { header: 'Name', key: 'name' },
      { header: 'Amount', key: 'amount' },
    ];
    const data = [{ name: 'Jane', amount: 5000 }];

    const buffer = await formatExcel(data, columns, 'Payments');

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer as unknown as ArrayBuffer);
    const worksheet = workbook.getWorksheet('Payments')!;

    expect(worksheet.getRow(2).getCell(2).value).toBe(5000);
  });
});
