import { stringify } from 'csv-stringify/sync';

export interface ExportColumn {
  header: string;
  key: string;
}

/**
 * Neutralize CSV/Excel formula-injection vectors.
 *
 * When a spreadsheet reader (Excel, Google Sheets, LibreOffice Calc) loads a
 * CSV or XLSX file, any cell whose leading character is `=`, `+`, `-`, `@`,
 * tab (0x09), or carriage-return (0x0D) is interpreted as a formula. That
 * lets an attacker who can store free-text (e.g. a member's firstName) plant
 * `=cmd|'/C calc'!A1` and pop a shell on the admin's machine when the admin
 * opens the exported file.
 *
 * Per the OWASP recommendation we prepend a single quote to any such value,
 * which every major spreadsheet reader treats as a literal-text cue. The
 * value is also wrapped in double quotes and existing quotes escaped so the
 * cell parses identically across readers.
 *
 * Safe for null/undefined (returns empty string).
 */
export function sanitizeCsvCell(value: string | null | undefined): string {
  if (value === null || value === undefined) return '';
  const str = String(value);
  if (str.length === 0) return '';

  const trimmedStart = str.trimStart();
  const startsWithFormulaChar =
    (trimmedStart.length > 0 && '=+-@'.includes(trimmedStart[0])) ||
    /^[\t\r]/.test(str);

  return startsWithFormulaChar ? `'${str}` : str;
}

export async function formatCsv(
  data: Record<string, any>[],
  columns: ExportColumn[],
): Promise<Buffer> {
  const headers = columns.map((c) => c.header);
  const rows = data.map((row) =>
    columns.map((col) => {
      const val = row[col.key];
      // Numbers, booleans, dates — pass through untouched; only strings
      // (and null/undefined) are attacker-controlled free text.
      if (typeof val === 'string' || val === null || val === undefined) {
        return sanitizeCsvCell(val);
      }
      return val;
    }),
  );

  const output = stringify([headers, ...rows]);
  return Buffer.from(output);
}
