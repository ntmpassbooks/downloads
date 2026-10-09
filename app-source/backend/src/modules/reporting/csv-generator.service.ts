export interface CsvColumnDef {
  header: string;
  key: string;
}

export interface CsvReportOptions {
  columns: CsvColumnDef[];
  data: Array<Record<string, any>>;
}

export class CsvGeneratorService {
  /**
   * Escapes a single value according to RFC 4180 rules, protecting against spreadsheet formula injection.
   */
  public static escapeValue(val: any): string {
    if (val === null || val === undefined) {
      return '""';
    }

    let str = String(val);

    // Formula injection protection: sanitize leading formula triggers
    if (/^[=+\-@\t\r]/.test(str)) {
      str = `'${str}`;
    }

    if (str.includes('"') || str.includes(',') || str.includes('\n') || str.includes('\r')) {
      return `"${str.replace(/"/g, '""')}"`;
    }

    return `"${str}"`;
  }

  /**
   * Builds an RFC 4180 compliant CSV string with UTF-8 BOM for Devanagari Excel compatibility.
   */
  public static generateCsv(options: CsvReportOptions): string {
    const { columns, data } = options;

    const headerLine = columns.map((c) => this.escapeValue(c.header)).join(',');
    const dataLines = data.map((row) => {
      return columns.map((c) => this.escapeValue(row[c.key])).join(',');
    });

    // \uFEFF UTF-8 BOM
    return '\uFEFF' + [headerLine, ...dataLines].join('\r\n');
  }
}
