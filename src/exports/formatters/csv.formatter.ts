import { stringify } from 'csv-stringify/sync';

export interface ExportColumn {
  header: string;
  key: string;
}

function sanitizeCellValue(val: unknown): string {
  if (val === null || val === undefined) return '';
  const str = String(val as string);
  if (str.length > 0 && '=+-@'.includes(str[0])) {
    return `'${str}`;
  }
  return str;
}

export async function formatCsv(
  data: Record<string, any>[],
  columns: ExportColumn[],
): Promise<Buffer> {
  const headers = columns.map((c) => c.header);
  const rows = data.map((row) =>
    columns.map((col) => sanitizeCellValue(row[col.key])),
  );

  const output = stringify([headers, ...rows]);
  return Buffer.from(output);
}
