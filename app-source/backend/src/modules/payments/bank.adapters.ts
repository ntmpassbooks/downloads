import crypto from 'node:crypto';
import { AppError } from '../../middleware/errorHandler.js';

export type SupportedBank = 'SBI' | 'ICICI' | 'AXIS' | 'AU' | 'KOTAK' | 'MOCK';

export const SUPPORTED_BANKS_LIST: Array<{ code: SupportedBank; name: string; marathiName: string }> = [
  { code: 'SBI', name: 'State Bank of India', marathiName: 'भारतीय स्टेट बँक (SBI)' },
  { code: 'ICICI', name: 'ICICI Bank', marathiName: 'आयसीआयसीआय बँक (ICICI Bank)' },
  { code: 'AXIS', name: 'Axis Bank', marathiName: 'ॲक्सिस बँक (Axis Bank)' },
  { code: 'AU', name: 'AU Small Finance Bank', marathiName: 'एयू स्मॉल फायनान्स बँक (AU Bank)' },
  { code: 'KOTAK', name: 'Kotak Mahindra Bank', marathiName: 'कोटक महिंद्रा बँक (Kotak Bank)' },
];

export interface CreateBankOrderParams {
  amount: number; // in Rupees
  currency: string;
  receipt: string;
  merchantUpiId?: string;
  accountName?: string;
  notes?: Record<string, string>;
}

export interface BankOrderResult {
  providerOrderId: string;
  amount: number;
  currency: string;
  bank: SupportedBank;
  upiIntentUrl?: string;
}

export interface VerifyBankPaymentParams {
  orderId: string; // providerOrderId
  paymentId: string; // providerPaymentId
  signature: string;
}

export interface BankWebhookPayload {
  event: string;
  providerOrderId?: string;
  providerPaymentId?: string;
  amount?: number;
  currency?: string;
  status?: string;
  notes?: Record<string, string>;
  rawPayload: any;
}

export interface PaymentProviderAdapter {
  readonly bank: SupportedBank;
  readonly displayName: string;

  /**
   * Checks whether the selected account type is supported for this bank's corporate API collection.
   */
  isAccountTypeSupported(accountType: 'CURRENT' | 'SAVINGS'): { supported: boolean; accountCategory?: string; reason?: string };

  /**
   * Validates bank-specific credentials for activation.
   * Returns valid=true only when required API onboarding credentials exist and account type is compatible.
   */
  validateCredentials(credentials: {
    merchantId?: string | null;
    apiSecret?: string | null;
    accountType?: string | null;
  }): { valid: boolean; error?: string };

  /**
   * Creates an order/collection request with the bank.
   */
  createOrder(params: CreateBankOrderParams): Promise<BankOrderResult>;

  /**
   * Verifies client-submitted payment signature using constant-time comparison.
   */
  verifyPaymentSignature(params: VerifyBankPaymentParams, secretKey?: string): boolean;

  /**
   * Verifies incoming webhook/callback signature.
   */
  verifyWebhookSignature(
    rawBody: string,
    headers: Record<string, string | string[] | undefined>,
    secretKey?: string
  ): boolean;

  /**
   * Parses webhook body and extracts order/payment metadata.
   */
  parseWebhookPayload(
    rawBody: string,
    headers: Record<string, string | string[] | undefined>
  ): BankWebhookPayload;

  /**
   * Helper for hermetic testing to generate valid payment signatures.
   */
  generateTestSignature(orderId: string, paymentId: string, secretKey?: string): string;

  /**
   * Helper for hermetic testing to generate valid webhook signatures.
   */
  generateTestWebhookSignature(rawBody: string, secretKey?: string): string;
}

/**
 * Base class containing common cryptographic and parsing utilities for bank adapters.
 */
abstract class BaseBankAdapter implements PaymentProviderAdapter {
  abstract readonly bank: SupportedBank;
  abstract readonly displayName: string;
  protected defaultSecret = 'ntm_default_secure_bank_secret_key_32chars!';

  public isAccountTypeSupported(accountType: 'CURRENT' | 'SAVINGS'): { supported: boolean; accountCategory: string; reason?: string } {
    if (accountType === 'CURRENT') {
      return {
        supported: true,
        accountCategory: 'चालू खाते (Current Account)',
      };
    }
    if (accountType === 'SAVINGS') {
      return {
        supported: true,
        accountCategory: 'संस्थात्मक बचत खाते (Institutional Savings Account)',
      };
    }
    return {
      supported: false,
      accountCategory: 'असमर्थित खाते प्रकार',
      reason: `${this.displayName}: केवळ अधिकृत चालू खाते किंवा संस्थात्मक बचत खाते समर्थित आहे.`,
    };
  }

  public validateCredentials(credentials: {
    merchantId?: string | null;
    apiSecret?: string | null;
    accountType?: string | null;
  }): { valid: boolean; error?: string } {
    if (!credentials.accountType || (credentials.accountType !== 'CURRENT' && credentials.accountType !== 'SAVINGS')) {
      return {
        valid: false,
        error: `${this.displayName}: खात्याचा प्रकार (चालू खाते किंवा संस्थात्मक बचत खाते) निवडणे अनिवार्य आहे.`,
      };
    }
    if (!credentials.merchantId || credentials.merchantId.trim().length < 3) {
      return {
        valid: false,
        error: `${this.displayName}: अधिकृत मर्चंट किंवा कॉर्पोरेट आयडी आवश्यक आहे.`,
      };
    }
    if (!credentials.apiSecret || credentials.apiSecret.trim().length < 8) {
      return {
        valid: false,
        error: `${this.displayName}: बँक API सुरक्षा एनक्रिप्शन / सिक्रेट की आवश्यक आहे (किमान ८ अक्षरे).`,
      };
    }
    return { valid: true };
  }

  public verifyPaymentSignature(params: VerifyBankPaymentParams, secretKey?: string): boolean {
    try {
      const secret = secretKey || this.defaultSecret;
      const payload = `${params.orderId}|${params.paymentId}`;
      const expectedSignature = crypto
        .createHmac('sha256', secret)
        .update(payload)
        .digest('hex');

      if (expectedSignature.length !== params.signature.length) {
        return false;
      }

      return crypto.timingSafeEqual(
        Buffer.from(expectedSignature, 'utf8'),
        Buffer.from(params.signature, 'utf8')
      );
    } catch {
      return false;
    }
  }

  public verifyWebhookSignature(
    rawBody: string,
    headers: Record<string, string | string[] | undefined>,
    secretKey?: string
  ): boolean {
    try {
      const secret = secretKey || this.defaultSecret;
      const signature =
        (headers['x-bank-signature'] as string) ||
        (headers['x-payment-signature'] as string) ||
        (headers[`x-${this.bank.toLowerCase()}-signature`] as string) ||
        '';

      if (!signature || !rawBody) {
        return false;
      }

      const expectedSignature = crypto
        .createHmac('sha256', secret)
        .update(rawBody)
        .digest('hex');

      if (expectedSignature.length !== signature.length) {
        return false;
      }

      return crypto.timingSafeEqual(
        Buffer.from(expectedSignature, 'utf8'),
        Buffer.from(signature, 'utf8')
      );
    } catch {
      return false;
    }
  }

  public parseWebhookPayload(
    rawBody: string,
    _headers: Record<string, string | string[] | undefined>
  ): BankWebhookPayload {
    const data = JSON.parse(rawBody);
    const event = data.event || 'payment.captured';
    const paymentEntity = data.payload?.payment?.entity || data.payment;
    const orderEntity = data.payload?.order?.entity || data.order;

    const providerOrderId = paymentEntity?.order_id || orderEntity?.id || data.providerOrderId || data.orderId;
    const providerPaymentId = paymentEntity?.id || data.providerPaymentId || data.paymentId;
    
    let amount: number | undefined;
    if (paymentEntity?.amount !== undefined) {
      amount = paymentEntity.amount / 100;
    } else if (orderEntity?.amount !== undefined) {
      amount = orderEntity.amount / 100;
    } else if (data.amount !== undefined) {
      amount = data.amount;
    }

    const currency = paymentEntity?.currency || orderEntity?.currency || data.currency || 'INR';
    const status = paymentEntity?.status || orderEntity?.status || data.status;
    const notes = paymentEntity?.notes || orderEntity?.notes || data.notes;

    return {
      event,
      providerOrderId,
      providerPaymentId,
      amount,
      currency,
      status,
      notes,
      rawPayload: data,
    };
  }

  public generateTestSignature(orderId: string, paymentId: string, secretKey?: string): string {
    const secret = secretKey || this.defaultSecret;
    return crypto
      .createHmac('sha256', secret)
      .update(`${orderId}|${paymentId}`)
      .digest('hex');
  }

  public generateTestWebhookSignature(rawBody: string, secretKey?: string): string {
    const secret = secretKey || this.defaultSecret;
    return crypto
      .createHmac('sha256', secret)
      .update(rawBody)
      .digest('hex');
  }

  abstract createOrder(params: CreateBankOrderParams): Promise<BankOrderResult>;
}

/**
 * SBI (State Bank of India) Adapter
 */
export class SBIAdapter extends BaseBankAdapter {
  readonly bank: SupportedBank = 'SBI';
  readonly displayName = 'भारतीय स्टेट बँक (SBI)';

  public async createOrder(params: CreateBankOrderParams): Promise<BankOrderResult> {
    if (!params.merchantUpiId || params.merchantUpiId.trim().length === 0) {
      throw new AppError('SBI व्यापारी UPI आयडी (Merchant VPA) आवश्यक आहे.', 400);
    }
    const randomSuffix = crypto.randomBytes(6).toString('hex');
    const orderId = `sbi_ord_${randomSuffix}`;
    const upiPa = params.merchantUpiId.trim();
    const upiPn = params.accountName || 'NTM Passbook Mandal';
    const upiIntentUrl = `upi://pay?pa=${encodeURIComponent(upiPa)}&pn=${encodeURIComponent(upiPn)}&am=${params.amount.toFixed(2)}&tr=${orderId}&cu=INR&tn=${encodeURIComponent('NTM Mandal Bishi')}`;

    return {
      providerOrderId: orderId,
      amount: params.amount,
      currency: params.currency || 'INR',
      bank: 'SBI',
      upiIntentUrl,
    };
  }
}

/**
 * ICICI Bank Adapter
 */
export class ICICIAdapter extends BaseBankAdapter {
  readonly bank: SupportedBank = 'ICICI';
  readonly displayName = 'आयसीआयसीआय बँक (ICICI Bank)';

  public async createOrder(params: CreateBankOrderParams): Promise<BankOrderResult> {
    if (!params.merchantUpiId || params.merchantUpiId.trim().length === 0) {
      throw new AppError('ICICI Eazypay व्यापारी UPI आयडी (Merchant VPA) आवश्यक आहे.', 400);
    }
    const randomSuffix = crypto.randomBytes(6).toString('hex');
    const orderId = `icici_ord_${randomSuffix}`;
    const upiPa = params.merchantUpiId.trim();
    const upiPn = params.accountName || 'NTM Passbook Mandal';
    const upiIntentUrl = `upi://pay?pa=${encodeURIComponent(upiPa)}&pn=${encodeURIComponent(upiPn)}&am=${params.amount.toFixed(2)}&tr=${orderId}&cu=INR&tn=${encodeURIComponent('NTM Mandal Bishi')}`;

    return {
      providerOrderId: orderId,
      amount: params.amount,
      currency: params.currency || 'INR',
      bank: 'ICICI',
      upiIntentUrl,
    };
  }
}

/**
 * Axis Bank Adapter
 */
export class AxisAdapter extends BaseBankAdapter {
  readonly bank: SupportedBank = 'AXIS';
  readonly displayName = 'ॲक्सिस बँक (Axis Bank)';

  public async createOrder(params: CreateBankOrderParams): Promise<BankOrderResult> {
    if (!params.merchantUpiId || params.merchantUpiId.trim().length === 0) {
      throw new AppError('Axis EasyPay व्यापारी UPI आयडी (Merchant VPA) आवश्यक आहे.', 400);
    }
    const randomSuffix = crypto.randomBytes(6).toString('hex');
    const orderId = `axis_ord_${randomSuffix}`;
    const upiPa = params.merchantUpiId.trim();
    const upiPn = params.accountName || 'NTM Passbook Mandal';
    const upiIntentUrl = `upi://pay?pa=${encodeURIComponent(upiPa)}&pn=${encodeURIComponent(upiPn)}&am=${params.amount.toFixed(2)}&tr=${orderId}&cu=INR&tn=${encodeURIComponent('NTM Mandal Bishi')}`;

    return {
      providerOrderId: orderId,
      amount: params.amount,
      currency: params.currency || 'INR',
      bank: 'AXIS',
      upiIntentUrl,
    };
  }
}

/**
 * AU Small Finance Bank Adapter
 */
export class AUAdapter extends BaseBankAdapter {
  readonly bank: SupportedBank = 'AU';
  readonly displayName = 'एयू स्मॉल फायनान्स बँक (AU Small Finance Bank)';

  public async createOrder(params: CreateBankOrderParams): Promise<BankOrderResult> {
    if (!params.merchantUpiId || params.merchantUpiId.trim().length === 0) {
      throw new AppError('AU व्यापारी UPI आयडी (Merchant VPA) आवश्यक आहे.', 400);
    }
    const randomSuffix = crypto.randomBytes(6).toString('hex');
    const orderId = `au_ord_${randomSuffix}`;
    const upiPa = params.merchantUpiId.trim();
    const upiPn = params.accountName || 'NTM Passbook Mandal';
    const upiIntentUrl = `upi://pay?pa=${encodeURIComponent(upiPa)}&pn=${encodeURIComponent(upiPn)}&am=${params.amount.toFixed(2)}&tr=${orderId}&cu=INR&tn=${encodeURIComponent('NTM Mandal Bishi')}`;

    return {
      providerOrderId: orderId,
      amount: params.amount,
      currency: params.currency || 'INR',
      bank: 'AU',
      upiIntentUrl,
    };
  }
}

/**
 * Kotak Mahindra Bank Adapter
 */
export class KotakAdapter extends BaseBankAdapter {
  readonly bank: SupportedBank = 'KOTAK';
  readonly displayName = 'कोटक महिंद्रा बँक (Kotak Mahindra Bank)';

  public async createOrder(params: CreateBankOrderParams): Promise<BankOrderResult> {
    if (!params.merchantUpiId || params.merchantUpiId.trim().length === 0) {
      throw new AppError('Kotak AutoCollect व्यापारी UPI आयडी (Merchant VPA) आवश्यक आहे.', 400);
    }
    const randomSuffix = crypto.randomBytes(6).toString('hex');
    const orderId = `kotak_ord_${randomSuffix}`;
    const upiPa = params.merchantUpiId.trim();
    const upiPn = params.accountName || 'NTM Passbook Mandal';
    const upiIntentUrl = `upi://pay?pa=${encodeURIComponent(upiPa)}&pn=${encodeURIComponent(upiPn)}&am=${params.amount.toFixed(2)}&tr=${orderId}&cu=INR&tn=${encodeURIComponent('NTM Mandal Bishi')}`;

    return {
      providerOrderId: orderId,
      amount: params.amount,
      currency: params.currency || 'INR',
      bank: 'KOTAK',
      upiIntentUrl,
    };
  }
}

/**
 * Bank Adapter Factory
 * Resolves the appropriate adapter and strictly blocks Bank of India (BOI) or unsupported banks.
 */
export class BankAdapterFactory {
  private static adapters: Map<SupportedBank, PaymentProviderAdapter> = new Map<SupportedBank, PaymentProviderAdapter>([
    ['SBI', new SBIAdapter()],
    ['ICICI', new ICICIAdapter()],
    ['AXIS', new AxisAdapter()],
    ['AU', new AUAdapter()],
    ['KOTAK', new KotakAdapter()],
  ]);

  public static getAdapter(bankCode: string): PaymentProviderAdapter {
    const normalized = (bankCode || '').trim().toUpperCase();

    // Explicit rejection of Bank of India (BOI)
    if (
      normalized === 'BOI' ||
      normalized === 'BANK OF INDIA' ||
      normalized.includes('BANKOFINDIA')
    ) {
      throw new AppError(
        'Bank of India (BOI) या प्रणालीमध्ये समर्थित नाही. कृपया SBI, ICICI, Axis, AU किंवा Kotak बँक निवडा.',
        400
      );
    }

    const adapter = this.adapters.get(normalized as SupportedBank);
    if (!adapter) {
      throw new AppError(
        `असमर्थित बँक निवडली (${bankCode}). केवळ SBI, ICICI, Axis, AU Small Finance आणि Kotak Mahindra बँक समर्थित आहेत.`,
        400
      );
    }

    return adapter;
  }

  public static registerAdapter(bank: SupportedBank, adapter: PaymentProviderAdapter): void {
    this.adapters.set(bank, adapter);
  }
}
