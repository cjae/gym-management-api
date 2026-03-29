import { stringify } from 'csv-stringify/sync';

export interface ExportColumn {
  header: string;
  key: string;
}

export async function formatCsv(
  data: Record<string, any>[],
  columns: ExportColumn[],
): Promise<Buffer> {
  const headers = columns.map((c) => c.header);
  const rows = data.map((row) =>
    columns.map((col) => {
      const val = row[col.key];
      return val === null || val === undefined ? '' : String(val);
    }),
  );

  const output = stringify([headers, ...rows]);
  return Buffer.from(output);
}
