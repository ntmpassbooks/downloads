import fs from 'node:fs';
import puppeteer from 'puppeteer-core';

export interface PdfReportOptions {
  title: string;
  subtitle?: string;
  mandalName: string;
  mandalCode: string;
  mandalRegNo?: string | null;
  periodLabel?: string;
  summaryCards?: Array<{ label: string; value: string; color?: string }>;
  tableHeaders: string[];
  tableRows: Array<Array<string | number>>;
  rightAlignCols?: number[]; // Column indices (0-based) to right-align
  centerAlignCols?: number[];
  footerNote?: string;
}

export class PdfGeneratorService {
  /**
   * Discovers the Chrome executable path across common Windows and Linux paths.
   */
  public static getChromeExecutablePath(): string {
    const candidates = [
      process.env.CHROME_PATH,
      'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
      'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
      process.env.LOCALAPPDATA ? `${process.env.LOCALAPPDATA}\\Google\\Chrome\\Application\\chrome.exe` : '',
      '/usr/bin/google-chrome',
      '/usr/bin/google-chrome-stable',
      '/usr/bin/chromium-browser',
      '/usr/bin/chromium',
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    ].filter(Boolean) as string[];

    for (const p of candidates) {
      if (fs.existsSync(p)) {
        return p;
      }
    }

    throw new Error('Chrome executable not found. Please install Chrome or set CHROME_PATH environment variable.');
  }

  /**
   * Generates a PDF buffer from a full HTML document string using puppeteer-core.
   */
  public static async generatePdfFromHtml(html: string): Promise<Buffer> {
    const executablePath = this.getChromeExecutablePath();
    const browser = await puppeteer.launch({
      executablePath,
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--font-render-hinting=none',
      ],
    });

    try {
      const page = await browser.newPage();
      await page.setContent(html, { waitUntil: 'domcontentloaded' });

      const pdfUint8Array = await page.pdf({
        format: 'A4',
        landscape: false,
        printBackground: true,
        margin: {
          top: '14mm',
          bottom: '16mm',
          left: '12mm',
          right: '12mm',
        },
        displayHeaderFooter: true,
        headerTemplate: '<div></div>',
        footerTemplate: `
          <div style="width: 100%; font-size: 8px; font-family: 'Noto Sans Devanagari', -apple-system, sans-serif; color: #64748b; display: flex; justify-content: space-between; padding: 0 12mm;">
            <span>NTM Passbook अधिकृत डिजिटल प्रत</span>
            <span>पान <span class="pageNumber"></span> / <span class="totalPages"></span></span>
          </div>
        `,
      });

      return Buffer.from(pdfUint8Array);
    } finally {
      await browser.close();
    }
  }

  /**
   * Builds bank-statement style HTML and converts it into a print-ready A4 PDF buffer.
   */
  public static async generateReportPdf(options: PdfReportOptions): Promise<Buffer> {
    const html = this.buildReportHtml(options);
    return this.generatePdfFromHtml(html);
  }

  /**
   * Builds bank-statement style HTML template.
   */
  private static buildReportHtml(options: PdfReportOptions): string {
    const {
      title,
      subtitle,
      mandalName,
      mandalCode,
      mandalRegNo,
      periodLabel,
      summaryCards = [],
      tableHeaders,
      tableRows,
      rightAlignCols = [],
      centerAlignCols = [],
      footerNote,
    } = options;

    const generatedAt = new Intl.DateTimeFormat('mr-IN', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: true,
    }).format(new Date());

    const summaryCardsHtml = summaryCards.length > 0 ? `
      <div class="summary-grid">
        ${summaryCards.map((card) => `
          <div class="summary-card" style="border-top: 3px solid ${card.color || '#059669'};">
            <div class="summary-label">${card.label}</div>
            <div class="summary-value" style="color: ${card.color || '#0f172a'};">${card.value}</div>
          </div>
        `).join('')}
      </div>
    ` : '';

    const tableHeadersHtml = tableHeaders.map((h, idx) => {
      const align = rightAlignCols.includes(idx) ? 'right' : centerAlignCols.includes(idx) ? 'center' : 'left';
      return `<th style="text-align: ${align};">${h}</th>`;
    }).join('');

    const tableRowsHtml = tableRows.map((row, rowIdx) => {
      const isEven = rowIdx % 2 === 0;
      const cells = row.map((val, colIdx) => {
        const align = rightAlignCols.includes(colIdx) ? 'right' : centerAlignCols.includes(colIdx) ? 'center' : 'left';
        return `<td style="text-align: ${align};">${val !== null && val !== undefined ? val : '-'}</td>`;
      }).join('');
      return `<tr class="${isEven ? 'even' : 'odd'}">${cells}</tr>`;
    }).join('');

    return `
      <!DOCTYPE html>
      <html lang="mr">
      <head>
        <meta charset="UTF-8">
        <title>${title} - ${mandalName}</title>
        <style>
          @page {
            size: A4 portrait;
            margin: 14mm 12mm 16mm 12mm;
          }
          * {
            box-sizing: border-box;
          }
          body {
            font-family: 'Noto Sans Devanagari', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
            color: #0f172a;
            margin: 0;
            padding: 0;
            background: #ffffff;
            font-size: 11px;
            line-height: 1.4;
          }
          .header-container {
            border-bottom: 2px solid #059669;
            padding-bottom: 12px;
            margin-bottom: 14px;
            display: flex;
            justify-content: space-between;
            align-items: flex-start;
          }
          .header-left {
            max-width: 65%;
          }
          .mandal-name {
            font-size: 20px;
            font-weight: 800;
            color: #065f46;
            margin: 0 0 4px 0;
            letter-spacing: -0.3px;
          }
          .mandal-meta {
            font-size: 10px;
            color: #475569;
            margin-bottom: 4px;
          }
          .report-title-badge {
            display: inline-block;
            background: #ecfdf5;
            color: #065f46;
            border: 1px solid #a7f3d0;
            font-weight: 700;
            font-size: 11px;
            padding: 3px 8px;
            border-radius: 6px;
            margin-top: 4px;
          }
          .header-right {
            text-align: right;
            font-size: 10px;
            color: #64748b;
          }
          .header-right .timestamp {
            font-weight: 600;
            color: #1e293b;
          }
          .summary-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(110px, 1fr));
            gap: 8px;
            margin-bottom: 14px;
          }
          .summary-card {
            background: #f8fafc;
            border: 1px solid #e2e8f0;
            border-radius: 8px;
            padding: 8px 10px;
          }
          .summary-label {
            font-size: 9px;
            color: #64748b;
            font-weight: 600;
            margin-bottom: 2px;
          }
          .summary-value {
            font-size: 14px;
            font-weight: 800;
            font-family: monospace, sans-serif;
          }
          table.data-table {
            width: 100%;
            border-collapse: collapse;
            font-size: 10px;
            margin-bottom: 16px;
          }
          table.data-table thead {
            display: table-header-group;
          }
          table.data-table tr {
            page-break-inside: avoid;
          }
          table.data-table th {
            background: #0f172a;
            color: #ffffff;
            font-weight: 700;
            padding: 7px 6px;
            border: 1px solid #0f172a;
            font-size: 9.5px;
          }
          table.data-table td {
            padding: 6px 6px;
            border: 1px solid #cbd5e1;
            color: #1e293b;
          }
          table.data-table tr.even td {
            background: #ffffff;
          }
          table.data-table tr.odd td {
            background: #f8fafc;
          }
          .signatures-container {
            margin-top: 24px;
            display: flex;
            justify-content: space-between;
            page-break-inside: avoid;
          }
          .sign-box {
            text-align: center;
            width: 180px;
          }
          .sign-line {
            border-bottom: 1px dashed #94a3b8;
            height: 35px;
            margin-bottom: 6px;
          }
          .sign-title {
            font-size: 11px;
            font-weight: 700;
            color: #334155;
          }
          .footer-note {
            margin-top: 14px;
            padding-top: 8px;
            border-top: 1px solid #e2e8f0;
            font-size: 9px;
            color: #64748b;
            text-align: center;
          }
        </style>
      </head>
      <body>
        <div class="header-container">
          <div class="header-left">
            <h1 class="mandal-name">${mandalName}</h1>
            <div class="mandal-meta">
              मंडळ कोड: <strong>${mandalCode}</strong>
              ${mandalRegNo ? ` | नोंदणी क्र: <strong>${mandalRegNo}</strong>` : ''}
            </div>
            <div class="report-title-badge">${title}${periodLabel ? ` — ${periodLabel}` : ''}</div>
            ${subtitle ? `<div style="font-size: 10px; color: #475569; margin-top: 2px;">${subtitle}</div>` : ''}
          </div>
          <div class="header-right">
            <div>निर्मिती दिनांक:</div>
            <div class="timestamp">${generatedAt}</div>
            <div style="margin-top: 4px; font-size: 9px; color: #059669; font-weight: 600;">✓ अधिकृत लेजर पडताळणी</div>
          </div>
        </div>

        ${summaryCardsHtml}

        <table class="data-table">
          <thead>
            <tr>${tableHeadersHtml}</tr>
          </thead>
          <tbody>
            ${tableRowsHtml}
          </tbody>
        </table>

        <div class="signatures-container">
          <div class="sign-box">
            <div class="sign-line"></div>
            <div class="sign-title">अध्यक्ष (President)</div>
            <div style="font-size: 9px; color: #64748b;">स्वाक्षरी व शिक्का</div>
          </div>
          <div class="sign-box">
            <div class="sign-line"></div>
            <div class="sign-title">खजिनदार (Treasurer)</div>
            <div style="font-size: 9px; color: #64748b;">स्वाक्षरी व शिक्का</div>
          </div>
        </div>

        ${footerNote ? `<div class="footer-note">${footerNote}</div>` : `
          <div class="footer-note">
            हा दस्तऐवज NTM Passbook प्रणालीद्वारे थेट अधिकृत वित्तीय नोंदींवरून तयार केला गेला आहे.
          </div>
        `}
      </body>
      </html>
    `;
  }

  /**
   * Generates a dedicated Bank-Receipt Style A4 PDF for a confirmed financial transaction.
   * Receipts are downloadable ONLY as PDF.
   */
  public static async generateReceiptPdf(receipt: {
    receiptNumber: string;
    transactionNumber: string;
    transactionType: string;
    transactionTypeMarathi: string;
    organization: { name: string; code: string; registrationNumber?: string | null };
    member: { fullName: string; phone: string };
    amount: number;
    amountInWords?: string;
    paymentMethod: string;
    transactionDate: string;
    recordedBy: { fullName: string; role: string };
    bishiMonth?: string | null;
    notes?: string | null;
  }): Promise<Buffer> {
    const formattedDate = new Intl.DateTimeFormat('mr-IN', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: true,
    }).format(new Date(receipt.transactionDate));

    const methodBadge = receipt.paymentMethod === 'CASH' ? 'रोख (CASH)' : 'ऑनलाइन (ONLINE)';
    const amountFormatted = `₹${receipt.amount.toLocaleString('en-IN')}`;

    const html = `
      <!DOCTYPE html>
      <html lang="mr">
      <head>
        <meta charset="UTF-8">
        <title>पावती - ${receipt.receiptNumber}</title>
        <style>
          @page {
            size: A4 portrait;
            margin: 15mm 15mm 15mm 15mm;
          }
          * { box-sizing: border-box; }
          body {
            font-family: 'Noto Sans Devanagari', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            color: #0f172a;
            margin: 0;
            padding: 0;
            background: #ffffff;
            line-height: 1.5;
          }
          .receipt-container {
            max-width: 620px;
            margin: 0 auto;
            border: 2px solid #059669;
            border-radius: 16px;
            padding: 24px;
            background: #ffffff;
            box-shadow: none;
          }
          .header {
            text-align: center;
            border-bottom: 2px dashed #cbd5e1;
            padding-bottom: 14px;
            margin-bottom: 16px;
          }
          .mandal-title {
            font-size: 22px;
            font-weight: 800;
            color: #065f46;
            margin: 0 0 4px 0;
          }
          .mandal-code {
            font-size: 12px;
            color: #475569;
            font-weight: 600;
          }
          .rcp-chip {
            display: inline-block;
            margin-top: 8px;
            padding: 4px 14px;
            background: #ecfdf5;
            color: #065f46;
            border: 1px solid #a7f3d0;
            border-radius: 8px;
            font-weight: 700;
            font-size: 13px;
          }
          .amount-box {
            background: #0f172a;
            color: #ffffff;
            padding: 14px 18px;
            border-radius: 12px;
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin: 14px 0;
          }
          .amount-label {
            font-size: 12px;
            color: #94a3b8;
          }
          .amount-value {
            font-size: 26px;
            font-weight: 800;
            color: #34d399;
            font-family: monospace;
          }
          .badge-confirmed {
            font-size: 11px;
            font-weight: 700;
            background: #065f46;
            color: #a7f3d0;
            padding: 3px 8px;
            border-radius: 6px;
            border: 1px solid #047857;
          }
          table.details-table {
            width: 100%;
            border-collapse: collapse;
            margin-top: 10px;
          }
          table.details-table td {
            padding: 8px 10px;
            font-size: 12px;
            border-bottom: 1px solid #f1f5f9;
          }
          table.details-table td.label-col {
            width: 35%;
            color: #64748b;
            font-weight: 600;
          }
          table.details-table td.value-col {
            width: 65%;
            font-weight: 700;
            color: #1e293b;
          }
          .signatures {
            display: flex;
            justify-content: space-between;
            margin-top: 28px;
            padding-top: 14px;
            border-top: 1px dashed #cbd5e1;
          }
          .sign-col {
            text-align: center;
            width: 160px;
          }
          .sign-line {
            height: 36px;
            border-bottom: 1px solid #94a3b8;
            margin-bottom: 4px;
          }
          .footer-note {
            text-align: center;
            font-size: 10px;
            color: #64748b;
            margin-top: 18px;
            border-top: 1px solid #f1f5f9;
            padding-top: 10px;
          }
        </style>
      </head>
      <body>
        <div class="receipt-container">
          <div class="header">
            <h1 class="mandal-title">${receipt.organization.name}</h1>
            <div class="mandal-code">
              मंडळ कोड: <strong>${receipt.organization.code}</strong>
              ${receipt.organization.registrationNumber ? ` | नोंदणी क्र: <strong>${receipt.organization.registrationNumber}</strong>` : ''}
            </div>
            <div class="rcp-chip">अधिकृत वित्तीय पावती (Official Receipt)</div>
          </div>

          <div class="amount-box">
            <div>
              <div class="amount-label">जमा / वाटप रक्कम</div>
              <div class="amount-value">${amountFormatted}</div>
            </div>
            <div class="badge-confirmed">✓ पुष्टी (CONFIRMED)</div>
          </div>

          <table class="details-table">
            <tr>
              <td class="label-col">पावती क्रमांक</td>
              <td class="value-col font-mono" style="color: #065f46;">${receipt.receiptNumber}</td>
            </tr>
            <tr>
              <td class="label-col">व्यवहार संदर्भ क्र.</td>
              <td class="value-col font-mono">${receipt.transactionNumber}</td>
            </tr>
            <tr>
              <td class="label-col">व्यवहार प्रकार</td>
              <td class="value-col">${receipt.transactionTypeMarathi}</td>
            </tr>
            <tr>
              <td class="label-col">संबंधित सदस्य</td>
              <td class="value-col">${receipt.member.fullName} (${receipt.member.phone})</td>
            </tr>
            ${receipt.bishiMonth ? `
              <tr>
                <td class="label-col">बिशी महिना</td>
                <td class="value-col">${receipt.bishiMonth}</td>
              </tr>
            ` : ''}
            <tr>
              <td class="label-col">भरणा पद्धत</td>
              <td class="value-col">${methodBadge}</td>
            </tr>
            <tr>
              <td class="label-col">दिनांक व वेळ</td>
              <td class="value-col">${formattedDate}</td>
            </tr>
            <tr>
              <td class="label-col">नोंदणीकर्ता / अधिकारी</td>
              <td class="value-col">${receipt.recordedBy.fullName} (${receipt.recordedBy.role === 'PRESIDENT' ? 'अध्यक्ष' : receipt.recordedBy.role === 'TREASURER' ? 'खजिनदार' : receipt.recordedBy.role})</td>
            </tr>
            ${receipt.notes ? `
              <tr>
                <td class="label-col">नोंद</td>
                <td class="value-col">${receipt.notes}</td>
              </tr>
            ` : ''}
          </table>

          <div class="signatures">
            <div class="sign-col">
              <div class="sign-line"></div>
              <div style="font-size: 11px; font-weight: 700;">सदस्य स्वाक्षरी</div>
              <div style="font-size: 9px; color: #64748b;">(Member Signature)</div>
            </div>
            <div class="sign-col">
              <div class="sign-line"></div>
              <div style="font-size: 11px; font-weight: 700;">अध्यक्ष / खजिनदार</div>
              <div style="font-size: 9px; color: #64748b;">(Authorized Officer)</div>
            </div>
          </div>

          <div class="footer-note">
            ही पावती NTM Passbook संगणकीय प्रणालीद्वारे तयार केली गेली आहे. संगणकीय पडताळणीकृत अधिकृत नोंद.
          </div>
        </div>
      </body>
      </html>
    `;

    return this.generatePdfFromHtml(html);
  }
}
