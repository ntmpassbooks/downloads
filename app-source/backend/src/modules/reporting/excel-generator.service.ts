import ExcelJS from 'exceljs';

export interface ExcelColumnDef {
  header: string;
  key: string;
  width?: number;
  isCurrency?: boolean;
  isNumber?: boolean;
  align?: 'left' | 'center' | 'right';
}

export interface ExcelReportOptions {
  sheetName: string;
  mandalName: string;
  mandalCode: string;
  mandalRegNo?: string | null;
  reportTitle: string;
  periodLabel?: string;
  columns: ExcelColumnDef[];
  data: Array<Record<string, any>>;
  summaryTotals?: Array<{ labelKey: string; sumKeys: string[] }>;
}

export class ExcelGeneratorService {
  /**
   * Generates a fully-styled, professional .xlsx workbook buffer using exceljs.
   */
  public static async generateReportWorkbook(options: ExcelReportOptions): Promise<Buffer> {
    const {
      sheetName,
      mandalName,
      mandalCode,
      mandalRegNo,
      reportTitle,
      periodLabel,
      columns,
      data,
      summaryTotals,
    } = options;

    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'NTM Passbook';
    workbook.created = new Date();

    const sheet = workbook.addWorksheet(sheetName.slice(0, 31), {
      views: [{ showGridLines: true }],
    });

    const totalCols = columns.length;

    // 1. Title Block
    // Row 1: Mandal Name
    const r1 = sheet.addRow([mandalName]);
    sheet.mergeCells(1, 1, 1, totalCols);
    r1.height = 28;
    r1.font = { name: 'Calibri', size: 16, bold: true, color: { argb: 'FF065F46' } };
    r1.alignment = { vertical: 'middle', horizontal: 'left' };

    // Row 2: Mandal Details
    const metaText = `मंडळ कोड: ${mandalCode}${mandalRegNo ? ` | नोंदणी क्र: ${mandalRegNo}` : ''}`;
    const r2 = sheet.addRow([metaText]);
    sheet.mergeCells(2, 1, 2, totalCols);
    r2.height = 18;
    r2.font = { name: 'Calibri', size: 10, italic: true, color: { argb: 'FF475569' } };
    r2.alignment = { vertical: 'middle', horizontal: 'left' };

    // Row 3: Report Title & Period
    const titleText = `${reportTitle}${periodLabel ? ` — ${periodLabel}` : ''} (निर्मिती: ${new Date().toLocaleDateString('mr-IN')})`;
    const r3 = sheet.addRow([titleText]);
    sheet.mergeCells(3, 1, 3, totalCols);
    r3.height = 20;
    r3.font = { name: 'Calibri', size: 11, bold: true, color: { argb: 'FF1E293B' } };
    r3.alignment = { vertical: 'middle', horizontal: 'left' };

    // Row 4: Empty spacer
    const r4 = sheet.addRow([]);
    r4.height = 10;

    // Row 5: Column Headers
    const headerRowIndex = 5;
    const headerValues = columns.map((c) => c.header);
    const headerRow = sheet.addRow(headerValues);
    headerRow.height = 26;

    headerRow.eachCell((cell, colNumber) => {
      cell.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FF0F172A' },
      };
      cell.font = {
        name: 'Calibri',
        size: 11,
        bold: true,
        color: { argb: 'FFFFFFFF' },
      };
      const colDef = columns[colNumber - 1];
      cell.alignment = {
        vertical: 'middle',
        horizontal: colDef?.align || (colDef?.isCurrency || colDef?.isNumber ? 'right' : 'left'),
        wrapText: true,
      };
      cell.border = {
        top: { style: 'medium', color: { argb: 'FF0F172A' } },
        bottom: { style: 'medium', color: { argb: 'FF0F172A' } },
        left: { style: 'thin', color: { argb: 'FF334155' } },
        right: { style: 'thin', color: { argb: 'FF334155' } },
      };
    });

    // 2. Data Rows
    const dataStartRowIndex = 6;
    data.forEach((item, index) => {
      const rowValues = columns.map((col) => item[col.key]);
      const dataRow = sheet.addRow(rowValues);
      dataRow.height = 20;

      const isEven = index % 2 === 0;
      dataRow.eachCell((cell, colNumber) => {
        const colDef = columns[colNumber - 1];

        // Format numbers & currency
        if (colDef?.isCurrency) {
          cell.numFmt = '₹#,##0.00';
          cell.alignment = { vertical: 'middle', horizontal: 'right' };
        } else if (colDef?.isNumber) {
          cell.numFmt = '#,##0';
          cell.alignment = { vertical: 'middle', horizontal: 'right' };
        } else {
          cell.alignment = {
            vertical: 'middle',
            horizontal: colDef?.align || 'left',
          };
        }

        cell.font = { name: 'Calibri', size: 10, color: { argb: 'FF1E293B' } };

        cell.fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: isEven ? 'FFFFFFFF' : 'FFF8FAFC' },
        };

        cell.border = {
          top: { style: 'thin', color: { argb: 'FFE2E8F0' } },
          bottom: { style: 'thin', color: { argb: 'FFE2E8F0' } },
          left: { style: 'thin', color: { argb: 'FFE2E8F0' } },
          right: { style: 'thin', color: { argb: 'FFE2E8F0' } },
        };
      });
    });

    const dataEndRowIndex = dataStartRowIndex + data.length - 1;

    // 3. Totals Row with Formulas
    if (data.length > 0 && summaryTotals && summaryTotals.length > 0) {
      for (const summary of summaryTotals) {
        const totalRowValues = new Array(totalCols).fill('');
        const labelColIndex = columns.findIndex((c) => c.key === summary.labelKey);
        if (labelColIndex >= 0) {
          totalRowValues[labelColIndex] = 'एकूण (Total)';
        }

        const totalRow = sheet.addRow(totalRowValues);
        totalRow.height = 24;

        columns.forEach((col, idx) => {
          const cell = totalRow.getCell(idx + 1);
          if (summary.sumKeys.includes(col.key)) {
            const colLetter = sheet.getColumn(idx + 1).letter;
            cell.value = {
              formula: `SUM(${colLetter}${dataStartRowIndex}:${colLetter}${dataEndRowIndex})`,
            };
            if (col.isCurrency) {
              cell.numFmt = '₹#,##0.00';
            } else if (col.isNumber) {
              cell.numFmt = '#,##0';
            }
          }

          cell.font = { name: 'Calibri', size: 11, bold: true, color: { argb: 'FF0F172A' } };
          cell.alignment = {
            vertical: 'middle',
            horizontal: col.align || (col.isCurrency || col.isNumber ? 'right' : 'left'),
          };
          cell.fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: 'FFF1F5F9' },
          };
          cell.border = {
            top: { style: 'thin', color: { argb: 'FF0F172A' } },
            bottom: { style: 'double', color: { argb: 'FF0F172A' } },
          };
        });
      }
    }

    // 4. Auto Column Widths
    sheet.columns.forEach((col, idx) => {
      const colDef = columns[idx];
      let maxLen = colDef?.header ? String(colDef.header).length : 10;
      data.forEach((row) => {
        const val = row[colDef.key];
        if (val !== null && val !== undefined) {
          const l = String(val).length;
          if (l > maxLen) maxLen = l;
        }
      });
      col.width = Math.max(colDef?.width || 12, Math.min(maxLen + 4, 45));
    });

    const buffer = await workbook.xlsx.writeBuffer();
    return Buffer.from(buffer);
  }
}
