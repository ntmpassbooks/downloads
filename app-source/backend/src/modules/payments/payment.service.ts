import crypto from 'node:crypto';
import { getDatabase } from '../../db/connection.js';
import { env } from '../../config/env.js';
import { AppError } from '../../middleware/errorHandler.js';
import { AuthenticatedUser } from '../../types/roles.js';
import { LedgerService } from '../ledger/ledger.service.js';
import {
  BankAdapterFactory,
  PaymentProviderAdapter,
  SupportedBank,
} from './bank.adapters.js';
import {
  PaymentConfig,
  PaymentConfigStatus,
  PaymentOrder,
} from './payment.types.js';
import {
  UpsertPaymentConfigInput,
  VerifyPaymentInput,
} from './payment.validation.js';
import { NotificationService } from '../notifications/notification.service.js';

// Derive 32-byte key for AES-256-GCM encryption of sensitive bank credentials
const ENCRYPTION_SECRET = env.BANK_ENCRYPTION_KEY || env.SESSION_SECRET;
const ENCRYPTION_KEY = crypto.createHash('sha256').update(ENCRYPTION_SECRET).digest();

function encryptSecret(text: string): { encrypted: string; iv: string; tag: string } {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', ENCRYPTION_KEY, iv);
  let encrypted = cipher.update(text, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const tag = cipher.getAuthTag().toString('hex');
  return {
    encrypted,
    iv: iv.toString('hex'),
    tag,
  };
}

function decryptSecret(encryptedHex: string, ivHex: string, tagHex: string): string | null {
  try {
    const decipher = crypto.createDecipheriv(
      'aes-256-gcm',
      ENCRYPTION_KEY,
      Buffer.from(ivHex, 'hex')
    );
    decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
    let decrypted = decipher.update(encryptedHex, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  } catch {
    return null;
  }
}

function maskAccountNumber(acc: string | null | undefined): string | null {
  if (!acc) return null;
  const clean = acc.trim();
  if (clean.length <= 4) return clean;
  return `XXXX...${clean.slice(-4)}`;
}

function validateQrCodeBase64(qrCodeData: string): void {
  let base64Content = qrCodeData.trim();
  const commaIdx = base64Content.indexOf(',');
  if (commaIdx !== -1) {
    base64Content = base64Content.slice(commaIdx + 1);
  }

  const buffer = Buffer.from(base64Content, 'base64');
  if (buffer.length === 0) {
    throw new AppError('अवैध QR कोड प्रतिमा (रिक्त डेटा).', 400);
  }

  if (buffer.length > 2 * 1024 * 1024) {
    throw new AppError('QR कोड प्रतिमेचा आकार कमाल २ एमबी (2MB) असावा.', 400);
  }

  // Check magic bytes: PNG (89 50 4E 47 0D 0A 1A 0A) or JPEG (FF D8 FF)
  const isPng =
    buffer.length >= 8 &&
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47 &&
    buffer[4] === 0x0d &&
    buffer[5] === 0x0a &&
    buffer[6] === 0x1a &&
    buffer[7] === 0x0a;

  const isJpeg =
    buffer.length >= 3 &&
    buffer[0] === 0xff &&
    buffer[1] === 0xd8 &&
    buffer[2] === 0xff;

  if (!isPng && !isJpeg) {
    throw new AppError('अवैध QR कोड प्रतिमा. केवळ PNG किंवा JPG/JPEG फॉरमॅट समर्थित आहे.', 400);
  }
}

export class PaymentService {
  /**
   * Retrieves Mandal's payment configuration.
   * Exposes clean UPI ID and QR code data. Strictly masks legacy account numbers and NEVER returns credentials/secrets.
   */
  public static getPaymentConfig(orgId: string, actorRole?: string): PaymentConfig | null {
    const db = getDatabase();
    const row = db
      .prepare('SELECT * FROM payment_configs WHERE organization_id = ?')
      .get(orgId) as any;

    if (!row) {
      return null;
    }

    const bank = (row.bank || row.provider || 'SBI') as SupportedBank;
    const isPresident = actorRole === 'PRESIDENT' || !actorRole;

    return {
      id: row.id,
      organizationId: row.organization_id,
      upiId: row.upi_id || null,
      hasQrCode: Boolean(row.qr_code_data),
      qrCodeData: row.qr_code_data || null,
      isActive: Boolean(row.is_active),
      notes: row.notes || null,
      bank,
      provider: bank,
      accountName: row.account_name || undefined,
      accountType: row.account_type || null,
      accountNumber: isPresident ? (row.account_number || null) : maskAccountNumber(row.account_number),
      maskedAccountNumber: maskAccountNumber(row.account_number),
      ifsc: row.ifsc || null,
      branch: row.branch || null,
      merchantId: row.merchant_id || null,
      hasCredentials: Boolean(row.credentials_encrypted),
      status: (row.status || (row.is_active ? 'ACTIVE' : 'PENDING')) as PaymentConfigStatus,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  /**
   * Sets or updates Mandal's payment configuration (President Only).
   * Validates UPI ID format and QR code image magic bytes (PNG/JPG max 2MB).
   */
  public static upsertPaymentConfig(
    orgId: string,
    actorId: string,
    input: UpsertPaymentConfigInput,
    ipAddress: string
  ): PaymentConfig {
    const db = getDatabase();

    const existing = db
      .prepare('SELECT * FROM payment_configs WHERE organization_id = ?')
      .get(orgId) as any;

    // Validate QR Code image if supplied
    if (input.qrCodeData && input.qrCodeData.trim().length > 0) {
      validateQrCodeBase64(input.qrCodeData);
    }

    // Determine target UPI and QR data
    const newUpi = input.upiId !== undefined ? input.upiId : (existing?.upi_id || null);
    const newQr = input.qrCodeData !== undefined ? input.qrCodeData : (existing?.qr_code_data || null);

    let isActive = existing ? existing.is_active : 0;
    if (input.isActive !== undefined) {
      isActive = input.isActive ? 1 : 0;
    }

    if (isActive === 1 && !newUpi && !newQr) {
      throw new AppError('ऑनलाइन पेमेंट सक्रिय करण्यासाठी UPI आयडी किंवा QR कोड असणे आवश्यक आहे.', 400);
    }

    // Legacy bank validation and secret handling if bank details are supplied
    let bank = input.bank ? (input.bank as SupportedBank) : (existing?.bank || 'SBI');
    let provider = bank;
    let newStatus: PaymentConfigStatus = isActive === 1 ? 'ACTIVE' : (existing?.status || 'PENDING');
    let encSecret: string | null = existing?.credentials_encrypted || null;
    let encIv: string | null = existing?.credentials_iv || null;
    let encTag: string | null = existing?.credentials_tag || null;

    if (input.bank) {
      BankAdapterFactory.getAdapter(bank);
      if (input.apiSecret && input.apiSecret.trim().length > 0) {
        const encrypted = encryptSecret(input.apiSecret.trim());
        encSecret = encrypted.encrypted;
        encIv = encrypted.iv;
        encTag = encrypted.tag;
      }
      const bankChanged = existing && existing.bank !== bank;
      const accountTypeChanged = existing && existing.account_type !== input.accountType;
      const requiresPending = bankChanged || accountTypeChanged || input.accountType === 'SAVINGS';
      if (requiresPending) {
        newStatus = 'PENDING';
        isActive = 0;
      }
    }

    let configId: string;
    if (existing) {
      configId = existing.id;
      db.prepare(`
        UPDATE payment_configs
        SET upi_id = ?, qr_code_data = ?, is_active = ?, notes = ?,
            bank = ?, provider = ?, account_name = ?, account_type = ?, account_number = ?, ifsc = ?,
            branch = ?, merchant_id = ?, credentials_encrypted = ?, credentials_iv = ?,
            credentials_tag = ?, status = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(
        newUpi,
        newQr,
        isActive,
        input.notes !== undefined ? input.notes : (existing.notes || null),
        bank,
        provider,
        input.accountName !== undefined ? input.accountName : existing.account_name,
        input.accountType !== undefined ? input.accountType : existing.account_type,
        input.accountNumber !== undefined ? input.accountNumber : existing.account_number,
        input.ifsc !== undefined ? input.ifsc : existing.ifsc,
        input.branch !== undefined ? input.branch : existing.branch,
        input.merchantId !== undefined ? input.merchantId : existing.merchant_id,
        encSecret,
        encIv,
        encTag,
        newStatus,
        configId
      );
    } else {
      configId = crypto.randomUUID();
      db.prepare(`
        INSERT INTO payment_configs (
          id, organization_id, upi_id, qr_code_data, is_active, notes,
          bank, provider, account_name, account_type, account_number, ifsc,
          branch, merchant_id, credentials_encrypted, credentials_iv,
          credentials_tag, status
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        configId,
        orgId,
        newUpi,
        newQr,
        isActive,
        input.notes || null,
        bank,
        provider,
        input.accountName || null,
        input.accountType || null,
        input.accountNumber || null,
        input.ifsc || null,
        input.branch || null,
        input.merchantId || null,
        encSecret,
        encIv,
        encTag,
        newStatus
      );
    }

    // Audit logs for QR code upload/removal and UPI changes
    if (input.qrCodeData !== undefined) {
      if (input.qrCodeData && input.qrCodeData.trim().length > 0) {
        db.prepare(`
          INSERT INTO audit_logs (id, organization_id, user_id, action, details, ip_address)
          VALUES (?, ?, ?, 'QR_CODE_UPLOADED', ?, ?)
        `).run(
          crypto.randomUUID(),
          orgId,
          actorId,
          JSON.stringify({ configId, hasQrCode: true }),
          ipAddress
        );
      } else if (existing?.qr_code_data) {
        db.prepare(`
          INSERT INTO audit_logs (id, organization_id, user_id, action, details, ip_address)
          VALUES (?, ?, ?, 'QR_CODE_REMOVED', ?, ?)
        `).run(
          crypto.randomUUID(),
          orgId,
          actorId,
          JSON.stringify({ configId, hasQrCode: false }),
          ipAddress
        );
      }
    }

    if (input.upiId !== undefined && input.upiId !== existing?.upi_id) {
      db.prepare(`
        INSERT INTO audit_logs (id, organization_id, user_id, action, details, ip_address)
        VALUES (?, ?, ?, 'UPI_ID_UPDATED', ?, ?)
      `).run(
        crypto.randomUUID(),
        orgId,
        actorId,
        JSON.stringify({ configId, upiId: input.upiId || null }),
        ipAddress
      );
    }

    db.prepare(`
      INSERT INTO audit_logs (id, organization_id, user_id, action, details, ip_address)
      VALUES (?, ?, ?, 'PAYMENT_CONFIG_UPDATED', ?, ?)
    `).run(
      crypto.randomUUID(),
      orgId,
      actorId,
      JSON.stringify({
        configId,
        upiId: newUpi,
        hasQrCode: Boolean(newQr),
        isActive: Boolean(isActive),
        status: newStatus,
      }),
      ipAddress
    );

    return this.getPaymentConfig(orgId)!;
  }

  /**
   * Changes payment configuration status (President Only).
   * Validates that real bank API credentials exist before allowing ACTIVE state.
   */
  public static updatePaymentConfigStatus(
    orgId: string,
    actorId: string,
    status: PaymentConfigStatus,
    ipAddress: string
  ): PaymentConfig {
    const db = getDatabase();

    const config = db
      .prepare('SELECT * FROM payment_configs WHERE organization_id = ?')
      .get(orgId) as any;

    if (!config) {
      throw new AppError('मंडळाची पेमेंट रचना सापडली नाही (Payment config not set)', 404);
    }

    const bank = (config.bank || config.provider || 'SBI') as SupportedBank;
    const adapter = BankAdapterFactory.getAdapter(bank);

    // CRITICAL: Cannot activate if bank credentials/onboarding are incomplete or account type is not supported
    if (status === 'ACTIVE') {
      const accountType = config.account_type as 'CURRENT' | 'SAVINGS' | null;
      if (!accountType) {
        throw new AppError(
          'पेमेंट सक्रिय करण्यासाठी प्रथम खात्याचा प्रकार (चालू खाते किंवा बचत खाते) निवडणे अनिवार्य आहे.',
          400
        );
      }

      const capability = adapter.isAccountTypeSupported(accountType);
      if (!capability.supported) {
        throw new AppError(
          capability.reason ||
            'या बँक खात्यावर ऑनलाइन पेमेंट सक्रिय करणे शक्य नाही. (Account type not supported for API payments)',
          400
        );
      }

      let decryptedSecret: string | null = null;
      if (config.credentials_encrypted && config.credentials_iv && config.credentials_tag) {
        decryptedSecret = decryptSecret(
          config.credentials_encrypted,
          config.credentials_iv,
          config.credentials_tag
        );
      }

      // If merchantId or secret is missing or adapter validation fails
      const validation = adapter.validateCredentials({
        merchantId: config.merchant_id,
        apiSecret: decryptedSecret,
        accountType,
      });

      if (!validation.valid) {
        throw new AppError(
          validation.error ||
            'बँक API/कलेक्शन सुविधा सक्रिय करण्यासाठी आवश्यक पडताळणी व क्रेडेंशियल्स पूर्ण करणे आवश्यक आहे. (Bank API credentials required)',
          400
        );
      }
    }

    const isActive = status === 'ACTIVE' ? 1 : 0;

    db.prepare(`
      UPDATE payment_configs
      SET status = ?, is_active = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(status, isActive, config.id);

    // Audit log
    db.prepare(`
      INSERT INTO audit_logs (id, organization_id, user_id, action, details, ip_address)
      VALUES (?, ?, ?, 'PAYMENT_CONFIG_STATUS_CHANGED', ?, ?)
    `).run(
      crypto.randomUUID(),
      orgId,
      actorId,
      JSON.stringify({
        configId: config.id,
        bank,
        previousStatus: config.status,
        newStatus: status,
        isActive: Boolean(isActive),
      }),
      ipAddress
    );

    return this.getPaymentConfig(orgId)!;
  }

  /**
   * Creates a payment order for a member's pending Bishi record.
   * - Validates active mandal configuration (UPI ID or QR Code).
   * - Sets initial status to ONLINE_PENDING.
   * - Notifies Mandal officers (President & Treasurer) for manual review.
   * - Amount strictly derived from authoritative bishi_records table.
   */
  public static async createPaymentOrder(
    orgId: string,
    memberId: string,
    bishiRecordId: string,
    ipAddress: string,
    providerOverride?: PaymentProviderAdapter
  ): Promise<{
    order: PaymentOrder;
    providerKeyId: string;
    bishiMonth: string;
    memberName: string;
    accountName: string;
    bank: SupportedBank;
    upiIntentUrl?: string;
    upiId?: string | null;
    hasQrCode?: boolean;
    qrCodeData?: string | null;
  }> {
    const db = getDatabase();

    // 1. Multi-tenant check: Bishi record belongs to this member and is PENDING
    const record = db
      .prepare(`
        SELECT r.*, u.full_name as member_name
        FROM bishi_records r
        INNER JOIN users u ON r.member_id = u.id AND r.organization_id = u.organization_id
        WHERE r.id = ? AND r.organization_id = ? AND r.member_id = ?
      `)
      .get(bishiRecordId, orgId, memberId) as any;

    if (!record) {
      throw new AppError('मासिक बीसी नोंद सापडली नाही (Bishi record not found for this member)', 404);
    }

    if (record.status === 'PAID') {
      throw new AppError('हा बीसी हप्ता आधीच भरला गेला आहे (This Bishi record is already paid)', 409);
    }

    // 2. Verify organization payment config is ACTIVE locally
    const rawConfig = db
      .prepare('SELECT * FROM payment_configs WHERE organization_id = ?')
      .get(orgId) as any;

    if (!rawConfig || !rawConfig.is_active || (rawConfig.status !== 'ACTIVE' && !rawConfig.upi_id && !rawConfig.qr_code_data)) {
      throw new AppError(
        'ऑनलाइन पेमेंट सध्या उपलब्ध नाही. कृपया खजिनदाराकडे रोख रक्कम जमा करा. (Online payment is not active)',
        400
      );
    }

    const bank = (rawConfig.bank || rawConfig.provider || 'SBI') as SupportedBank;
    const adapter = providerOverride || (rawConfig.bank ? BankAdapterFactory.getAdapter(bank) : null);
    const merchantUpi = rawConfig.upi_id || rawConfig.merchant_id || '';
    const accountName = rawConfig.account_name || 'NTM Passbook Mandal';

    // 3. Prevent duplicate active orders: check if an unexpired order exists
    const existingOrder = db
      .prepare(`
        SELECT * FROM payment_orders
        WHERE organization_id = ? AND member_id = ? AND bishi_record_id = ?
          AND status IN ('ONLINE_PENDING', 'CREATED', 'PENDING')
      `)
      .get(orgId, memberId, bishiRecordId) as any;

    if (existingOrder) {
      let existingUpi: string | undefined;
      if (merchantUpi) {
        existingUpi = `upi://pay?pa=${encodeURIComponent(merchantUpi)}&pn=${encodeURIComponent(accountName)}&am=${existingOrder.amount.toFixed(2)}&tr=${existingOrder.provider_order_id || existingOrder.id}&cu=INR&tn=${encodeURIComponent('NTM Mandal Bishi')}`;
      }

      return {
        order: this.mapOrder({ ...existingOrder, member_name: record.member_name, bishi_month: record.month_year }),
        providerKeyId: rawConfig.merchant_id || rawConfig.upi_id || bank,
        bishiMonth: record.month_year,
        memberName: record.member_name,
        accountName,
        bank,
        upiIntentUrl: existingUpi,
        upiId: rawConfig.upi_id || null,
        hasQrCode: Boolean(rawConfig.qr_code_data),
        qrCodeData: rawConfig.qr_code_data || null,
      };
    }

    // 4. Create order reference
    const orderId = crypto.randomUUID();
    const idempotencyKey = `ord_${crypto.randomUUID()}`;
    let providerOrderId = `prov_${orderId.slice(0, 8)}`;
    let upiIntentUrl: string | undefined;

    if (adapter && rawConfig.account_name && (rawConfig.merchant_id || rawConfig.upi_id)) {
      try {
        const providerResult = await adapter.createOrder({
          amount: record.expected_amount,
          currency: 'INR',
          receipt: `RCP_ORD_${orderId.slice(0, 8)}`,
          merchantUpiId: merchantUpi,
          accountName,
          notes: {
            organizationId: orgId,
            memberId,
            bishiRecordId,
            monthYear: record.month_year,
            bank,
          },
        });
        providerOrderId = providerResult.providerOrderId;
        upiIntentUrl = providerResult.upiIntentUrl;
      } catch {
        // Fallback
      }
    }

    if (!upiIntentUrl && merchantUpi) {
      upiIntentUrl = `upi://pay?pa=${encodeURIComponent(merchantUpi)}&pn=${encodeURIComponent(accountName)}&am=${record.expected_amount.toFixed(2)}&tr=${providerOrderId}&cu=INR&tn=${encodeURIComponent('NTM Mandal Bishi')}`;
    }

    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    const initialStatus = rawConfig.qr_code_data || !rawConfig.merchant_id ? 'ONLINE_PENDING' : 'CREATED';

    db.prepare(`
      INSERT INTO payment_orders (
        id, organization_id, member_id, bishi_record_id, amount, currency,
        bank, provider, provider_order_id, status, idempotency_key, expires_at
      ) VALUES (?, ?, ?, ?, ?, 'INR', ?, ?, ?, ?, ?, ?)
    `).run(
      orderId,
      orgId,
      memberId,
      bishiRecordId,
      record.expected_amount,
      bank,
      bank,
      providerOrderId,
      initialStatus,
      idempotencyKey,
      expiresAt
    );

    // Audit log
    db.prepare(`
      INSERT INTO audit_logs (id, organization_id, user_id, action, details, ip_address)
      VALUES (?, ?, ?, 'PAYMENT_ORDER_CREATED', ?, ?)
    `).run(
      crypto.randomUUID(),
      orgId,
      memberId,
      JSON.stringify({
        orderId,
        bank,
        providerOrderId,
        bishiRecordId,
        amount: record.expected_amount,
        monthYear: record.month_year,
      }),
      ipAddress
    );

    // Send notification to President & Treasurer
    NotificationService.sendToRoles(
      orgId,
      ['PRESIDENT', 'TREASURER'],
      {
        type: 'PAYMENT_INITIATED',
        title: 'नवीन ऑनलाइन भरणा सूचना',
        message: `${record.member_name} यांनी ${record.month_year} साठी ₹${record.expected_amount} चा ऑनलाइन भरणा केल्याची नोंद पाठवली आहे. कृपया पडताळणी करा.`,
        entityType: 'PAYMENT',
        entityId: orderId,
        idempotencyKey: `payment-initiated-officer-${orderId}`,
        data: { orderId, amount: record.expected_amount, memberId, monthYear: record.month_year },
      }
    ).catch((err) => console.error('Notification error (payment initiated officer):', err));

    const saved = db.prepare('SELECT * FROM payment_orders WHERE id = ?').get(orderId) as any;

    return {
      order: this.mapOrder({ ...saved, member_name: record.member_name, bishi_month: record.month_year }),
      providerKeyId: rawConfig.merchant_id || rawConfig.upi_id || bank,
      bishiMonth: record.month_year,
      memberName: record.member_name,
      accountName,
      bank,
      upiIntentUrl,
      upiId: rawConfig.upi_id || null,
      hasQrCode: Boolean(rawConfig.qr_code_data),
      qrCodeData: rawConfig.qr_code_data || null,
    };
  }

  /**
   * Client-side Payment Verification.
   * - Verifies cryptographic signature with bank adapter.
   * - Idempotent: returns existing transaction if already confirmed.
   * - Atomic ledger recording inside BEGIN IMMEDIATE.
   */
  public static async verifyPaymentAndFinalize(
    orgId: string,
    memberId: string,
    input: VerifyPaymentInput,
    ipAddress: string,
    providerOverride?: PaymentProviderAdapter
  ): Promise<{
    success: true;
    transactionId: string;
    transactionNumber: string;
    receiptNumber: string;
    bishiMonth: string;
    amount: number;
    bank: SupportedBank;
  }> {
    const db = getDatabase();

    // 1. Fetch order
    const order = db
      .prepare('SELECT * FROM payment_orders WHERE id = ? AND organization_id = ? AND member_id = ?')
      .get(input.orderId, orgId, memberId) as any;

    if (!order) {
      throw new AppError('पेमेंट ऑर्डर सापडली नाही (Payment order not found)', 404);
    }

    const bank = (order.bank || order.provider || 'SBI') as SupportedBank;
    const adapter = providerOverride || BankAdapterFactory.getAdapter(bank);

    // 2. Strict Idempotency Check: if order already succeeded
    if (order.status === 'SUCCESS' && order.financial_transaction_id) {
      const existingTxn = db
        .prepare('SELECT * FROM financial_transactions WHERE id = ?')
        .get(order.financial_transaction_id) as any;

      if (existingTxn) {
        return {
          success: true,
          transactionId: existingTxn.id,
          transactionNumber: existingTxn.transaction_number,
          receiptNumber: `RCP-${existingTxn.transaction_number.replace(/^TXN-/, '')}`,
          bishiMonth: order.bishi_record_id,
          amount: existingTxn.amount,
          bank,
        };
      }
    }

    // 3. Check expiration
    if (new Date(order.expires_at).getTime() < Date.now()) {
      db.prepare("UPDATE payment_orders SET status = 'EXPIRED' WHERE id = ?").run(order.id);
      NotificationService.sendNotification({
        organizationId: orgId,
        userId: memberId,
        type: 'PAYMENT_EXPIRED',
        title: 'पेमेंट वेळ संपली',
        message: `₹${order.amount} चे ऑनलाइन पेमेंट निर्धारित वेळेत पूर्ण न झाल्याने रद्द झाले आहे. कृपया पुन्हा प्रयत्न करा.`,
        entityType: 'PAYMENT',
        entityId: order.id,
        idempotencyKey: `payment-expired-${order.id}`,
        data: { orderId: order.id, amount: order.amount },
      }).catch(err => console.error('Notification error (payment expired):', err));
      throw new AppError('पेमेंट ऑर्डर कालबाह्य झाली आहे. कृपया नवीन पेमेंट सुरू करा. (Order expired)', 400);
    }

    // 4. Retrieve secret key for verification
    const configRow = db
      .prepare('SELECT credentials_encrypted, credentials_iv, credentials_tag FROM payment_configs WHERE organization_id = ?')
      .get(orgId) as any;

    let secretKey: string | undefined;
    if (configRow?.credentials_encrypted && configRow?.credentials_iv && configRow?.credentials_tag) {
      secretKey = decryptSecret(
        configRow.credentials_encrypted,
        configRow.credentials_iv,
        configRow.credentials_tag
      ) || undefined;
    }

    // 5. Verify signature via adapter
    const isSignatureValid = adapter.verifyPaymentSignature(
      {
        orderId: order.provider_order_id,
        paymentId: input.providerPaymentId,
        signature: input.providerSignature,
      },
      secretKey
    );

    if (!isSignatureValid) {
      db.prepare("UPDATE payment_orders SET status = 'FAILED' WHERE id = ?").run(order.id);

      NotificationService.sendNotification({
        organizationId: orgId,
        userId: memberId,
        type: 'PAYMENT_FAILED',
        title: 'ऑनलाइन पेमेंट अयशस्वी',
        message: `₹${order.amount} चे ऑनलाइन पेमेंट अयशस्वी झाले. कृपया बँक शिल्लक तपासा किंवा पुन्हा प्रयत्न करा.`,
        entityType: 'PAYMENT',
        entityId: order.id,
        idempotencyKey: `payment-failed-${order.id}`,
        data: { orderId: order.id, amount: order.amount },
      }).catch(err => console.error('Notification error (payment failed):', err));

      db.prepare(`
        INSERT INTO audit_logs (id, organization_id, user_id, action, details, ip_address)
        VALUES (?, ?, ?, 'PAYMENT_VERIFICATION_FAILED', ?, ?)
      `).run(
        crypto.randomUUID(),
        orgId,
        memberId,
        JSON.stringify({
          orderId: order.id,
          bank,
          providerOrderId: order.provider_order_id,
          providerPaymentId: input.providerPaymentId,
          reason: 'Invalid bank signature',
        }),
        ipAddress
      );

      throw new AppError('पेमेंट स्वाक्षरी अवैध आहे. कृपया पुन्हा प्रयत्न करा. (Invalid signature)', 400);
    }

    // 6. Atomic Ledger Recording
    const txn = LedgerService.recordOnlineBishiPayment(
      orgId,
      order.bishi_record_id,
      order.id,
      input.providerPaymentId,
      memberId,
      ipAddress
    );

    // Audit log
    db.prepare(`
      INSERT INTO audit_logs (id, organization_id, user_id, action, details, ip_address)
      VALUES (?, ?, ?, 'ONLINE_PAYMENT_SUCCESS', ?, ?)
    `).run(
      crypto.randomUUID(),
      orgId,
      memberId,
      JSON.stringify({
        orderId: order.id,
        bank,
        transactionId: txn.id,
        transactionNumber: txn.transactionNumber,
        amount: txn.amount,
        paymentMethod: 'ONLINE_UPI',
      }),
      ipAddress
    );

    const receiptNumber = `RCP-${txn.transactionNumber.replace(/^TXN-/, '')}`;

    return {
      success: true,
      transactionId: txn.id,
      transactionNumber: txn.transactionNumber,
      receiptNumber,
      bishiMonth: txn.bishiMonth || '',
      amount: txn.amount,
      bank,
    };
  }

  /**
   * Handles incoming Provider Webhooks / Callbacks (Server-to-Server).
   */
  public static async handleWebhook(
    rawBody: string,
    headers: Record<string, string | string[] | undefined>,
    ipAddress: string,
    providerOverride?: PaymentProviderAdapter
  ): Promise<{ received: boolean; processed: boolean; message: string }> {
    const db = getDatabase();

    // Parse payload to locate order
    let parsed: any;
    try {
      parsed = JSON.parse(rawBody);
    } catch {
      throw new AppError('अवैध वेबहूक पेलोड (Invalid JSON payload)', 400);
    }

    const providerOrderId =
      parsed.payload?.payment?.entity?.order_id ||
      parsed.payload?.order?.entity?.id ||
      parsed.providerOrderId ||
      parsed.orderId ||
      parsed.order_id;

    if (!providerOrderId) {
      return {
        received: true,
        processed: false,
        message: 'Missing provider order ID in webhook payload',
      };
    }

    // Locate order in database
    const order = db
      .prepare('SELECT * FROM payment_orders WHERE provider_order_id = ?')
      .get(providerOrderId) as any;

    if (!order) {
      return {
        received: true,
        processed: false,
        message: `Order not found: ${providerOrderId}`,
      };
    }

    const bank = (order.bank || order.provider || 'SBI') as SupportedBank;
    const adapter = providerOverride || BankAdapterFactory.getAdapter(bank);

    // Retrieve decrypted secret for verification
    const configRow = db
      .prepare('SELECT credentials_encrypted, credentials_iv, credentials_tag FROM payment_configs WHERE organization_id = ?')
      .get(order.organization_id) as any;

    let secretKey: string | undefined;
    if (configRow?.credentials_encrypted && configRow?.credentials_iv && configRow?.credentials_tag) {
      secretKey = decryptSecret(
        configRow.credentials_encrypted,
        configRow.credentials_iv,
        configRow.credentials_tag
      ) || undefined;
    }

    // Verify webhook signature
    const isValid = adapter.verifyWebhookSignature(rawBody, headers, secretKey);
    if (!isValid) {
      db.prepare(`
        INSERT INTO audit_logs (id, organization_id, user_id, action, details, ip_address)
        VALUES (?, ?, NULL, 'WEBHOOK_SIGNATURE_FAILED', ?, ?)
      `).run(
        crypto.randomUUID(),
        order.organization_id,
        JSON.stringify({ reason: 'Invalid signature', bank }),
        ipAddress
      );

      throw new AppError('अवैध वेबहूक स्वाक्षरी (Invalid webhook signature)', 400);
    }

    // Idempotency: if already SUCCESS, acknowledge without duplicate ledger write
    if (order.status === 'SUCCESS') {
      return {
        received: true,
        processed: false,
        message: 'Order already finalized and recorded',
      };
    }

    const eventData = adapter.parseWebhookPayload(rawBody, headers);

    // Verify Amount if provided
    if (eventData.amount && eventData.amount !== order.amount) {
      throw new AppError(
        `वेबहूक रक्कम (₹${eventData.amount}) आणि ऑर्डर रक्कम (₹${order.amount}) जुळत नाही`,
        400
      );
    }

    const providerPaymentId =
      eventData.providerPaymentId || `pay_wh_${crypto.randomBytes(4).toString('hex')}`;

    // Execute atomic recording
    const txn = LedgerService.recordOnlineBishiPayment(
      order.organization_id,
      order.bishi_record_id,
      order.id,
      providerPaymentId,
      order.member_id,
      ipAddress
    );

    // Audit log
    db.prepare(`
      INSERT INTO audit_logs (id, organization_id, user_id, action, details, ip_address)
      VALUES (?, ?, ?, 'ONLINE_PAYMENT_SUCCESS', ?, ?)
    `).run(
      crypto.randomUUID(),
      order.organization_id,
      order.member_id,
      JSON.stringify({
        orderId: order.id,
        bank,
        transactionId: txn.id,
        transactionNumber: txn.transactionNumber,
        amount: txn.amount,
        paymentMethod: 'ONLINE_UPI',
        source: 'WEBHOOK',
      }),
      ipAddress
    );

    return {
      received: true,
      processed: true,
      message: 'Payment successfully finalized via webhook',
    };
  }

  private static mapOrder(order: any): PaymentOrder {
    const bank = (order.bank || order.provider || 'SBI') as SupportedBank;
    return {
      id: order.id,
      organizationId: order.organization_id,
      memberId: order.member_id,
      memberName: order.member_name,
      memberPhone: order.member_phone,
      paymentType: order.payment_type || 'BISHI',
      bishiRecordId: order.bishi_record_id || null,
      loanId: order.loan_id || null,
      bishiMonth: order.bishi_month,
      amount: order.amount,
      currency: order.currency || 'INR',
      status: order.status,
      idempotencyKey: order.idempotency_key,
      financialTransactionId: order.financial_transaction_id || null,
      approvedBy: order.approved_by || null,
      approvedAt: order.approved_at || null,
      rejectedBy: order.rejected_by || null,
      rejectedAt: order.rejected_at || null,
      rejectionReason: order.rejection_reason || null,
      notes: order.notes || null,
      bank,
      provider: bank,
      providerOrderId: order.provider_order_id,
      providerPaymentId: order.provider_payment_id || null,
      expiresAt: order.expires_at,
      completedAt: order.completed_at || null,
      createdAt: order.created_at,
      updatedAt: order.updated_at,
    };
  }

  /**
   * Retrieves all ONLINE_PENDING orders for the Mandal (President & Treasurer review).
   */
  public static getPendingPaymentOrders(orgId: string): PaymentOrder[] {
    const db = getDatabase();
    const rows = db
      .prepare(`
        SELECT o.*, u.full_name as member_name, u.phone as member_phone, b.month_year as bishi_month, l.amount as loan_principal
        FROM payment_orders o
        INNER JOIN users u ON o.member_id = u.id AND o.organization_id = u.organization_id
        LEFT JOIN bishi_records b ON o.bishi_record_id = b.id AND o.organization_id = b.organization_id
        LEFT JOIN loans l ON o.loan_id = l.id AND o.organization_id = l.organization_id
        WHERE o.organization_id = ? AND o.status = 'ONLINE_PENDING'
        ORDER BY o.created_at DESC
      `)
      .all(orgId) as any[];

    return rows.map((r) => this.mapOrder(r));
  }

  /**
   * Approves an online payment order atomically (President & Treasurer only).
   * Supports both Bishi payments and Loan repayments.
   * Cross-officer protection: Self-approval is strictly forbidden!
   */
  public static approveOnlinePayment(
    orgId: string,
    actor: AuthenticatedUser,
    orderId: string,
    ipAddress: string
  ): {
    success: true;
    transactionId: string;
    transactionNumber: string;
    receiptNumber: string;
    bishiMonth: string;
    amount: number;
    paymentMethod: 'ONLINE';
  } {
    const db = getDatabase();

    db.exec('BEGIN IMMEDIATE TRANSACTION;');
    try {
      const order = db
        .prepare('SELECT * FROM payment_orders WHERE id = ? AND organization_id = ?')
        .get(orderId, orgId) as any;

      if (!order) {
        throw new AppError('पेमेंट ऑर्डर सापडली नाही (Payment order not found)', 404);
      }

      // Self-approval safeguard: Cross-officer approval strictly enforced!
      if (order.member_id === actor.id) {
        throw new AppError(
          'अधिकारी स्वतःच्या खात्याचा भरणा मंजूर करू शकत नाही. दुसऱ्या अधिकाऱ्याची (अध्यक्ष/खजिनदार) मंजुरी आवश्यक आहे. (Self-approval not allowed: cross-officer confirmation required)',
          403
        );
      }

      if (order.status === 'ONLINE_CONFIRMED' || order.status === 'SUCCESS') {
        throw new AppError('हा भरणा आधीच मंजूर झाला आहे (Already confirmed)', 409);
      }

      if (order.status === 'ONLINE_REJECTED') {
        throw new AppError('हा भरणा आधीच नाकारण्यात आला आहे (Already rejected)', 400);
      }

      if (order.status !== 'ONLINE_PENDING' && order.status !== 'CREATED' && order.status !== 'PENDING') {
        throw new AppError('हा भरणा मंजूर करता येत नाही (Invalid order status)', 400);
      }

      const approverTitle = actor.role === 'PRESIDENT' ? 'अध्यक्ष' : 'खजिनदार';

      // ==========================================
      // Case A: Online Loan Repayment Order
      // ==========================================
      if (order.payment_type === 'LOAN_REPAYMENT' || order.loan_id) {
        const loan = db
          .prepare('SELECT * FROM loans WHERE id = ? AND organization_id = ?')
          .get(order.loan_id, orgId) as any;

        if (!loan) {
          throw new AppError('कर्ज नोंद सापडली नाही (Loan record not found)', 404);
        }

        if (loan.status === 'CLOSED') {
          throw new AppError('हे कर्ज आधीच पूर्ण भरले गेले आहे (Already fully repaid)', 400);
        }

        if (loan.status === 'CANCELLED') {
          throw new AppError('हे कर्ज रद्द करण्यात आले आहे (This loan is cancelled)', 400);
        }

        const sumRow = db
          .prepare(`
            SELECT COALESCE(SUM(amount), 0) as total_repaid
            FROM financial_transactions
            WHERE organization_id = ? AND transaction_type = 'LOAN_REPAYMENT'
              AND reference_id IN (SELECT id FROM loan_repayments WHERE loan_id = ?)
              AND status = 'CONFIRMED'
          `)
          .get(orgId, loan.id) as any;

        const currentRepaid = sumRow.total_repaid || 0;
        const targetTotal = loan.total_payable > 0 ? loan.total_payable : loan.amount;
        const outstanding = targetTotal - currentRepaid;

        if (order.amount > outstanding) {
          throw new AppError(`परतफेड रक्कम उर्वरित बाकी रकमेपेक्षा (₹${outstanding}) जास्त असू शकत नाही`, 400);
        }

        const repaymentId = crypto.randomUUID();
        const transactionId = crypto.randomUUID();
        const transactionNumber = LedgerService.generateTransactionNumber();
        const repaymentDate = new Date().toISOString();

        // Allocate across installments
        const installments = db
          .prepare(`
            SELECT * FROM loan_installments
            WHERE loan_id = ? AND organization_id = ? AND status != 'PAID'
            ORDER BY installment_number ASC
          `)
          .all(loan.id, orgId) as any[];

        let remainingToAllocate = order.amount;
        let totalPrincipalPaid = 0;
        let totalInterestPaid = 0;

        const updateInstallmentStmt = db.prepare(`
          UPDATE loan_installments
          SET paid_amount = ?, paid_date = ?, status = ?, updated_at = CURRENT_TIMESTAMP
          WHERE id = ?
        `);

        for (const inst of installments) {
          if (remainingToAllocate <= 0) break;
          const unpaid = inst.total_amount - inst.paid_amount;
          const alloc = Math.min(remainingToAllocate, unpaid);
          const newInstPaid = inst.paid_amount + alloc;
          remainingToAllocate -= alloc;

          const ratio = inst.total_amount > 0 ? alloc / inst.total_amount : 1;
          const pAlloc = Math.round(inst.principal_amount * ratio);
          const iAlloc = alloc - pAlloc;
          totalPrincipalPaid += pAlloc;
          totalInterestPaid += iAlloc;

          const newStatus = newInstPaid >= inst.total_amount ? 'PAID' : 'PARTIALLY_PAID';
          updateInstallmentStmt.run(newInstPaid, repaymentDate, newStatus, inst.id);
        }

        if (installments.length === 0) {
          totalPrincipalPaid = order.amount;
          totalInterestPaid = 0;
        }

        // Insert into loan_repayments
        db.prepare(`
          INSERT INTO loan_repayments (
            id, organization_id, loan_id, member_id, actor_id,
            amount, principal_paid, interest_paid, payment_method, repayment_date, transaction_id, notes
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'ONLINE', ?, ?, ?)
        `).run(
          repaymentId,
          orgId,
          loan.id,
          order.member_id,
          actor.id,
          order.amount,
          totalPrincipalPaid,
          totalInterestPaid,
          repaymentDate,
          transactionId,
          `ऑनलाइन UPI कर्ज परतफेड मंजुरी (${approverTitle}: ${actor.fullName || actor.role})`
        );

        // Insert into financial_transactions
        db.prepare(`
          INSERT INTO financial_transactions (
            id, organization_id, member_id, actor_id, transaction_type,
            reference_id, transaction_number, amount, payment_method,
            transaction_date, status, notes
          ) VALUES (?, ?, ?, ?, 'LOAN_REPAYMENT', ?, ?, ?, 'ONLINE', CURRENT_TIMESTAMP, 'CONFIRMED', ?)
        `).run(
          transactionId,
          orgId,
          order.member_id,
          actor.id,
          repaymentId,
          transactionNumber,
          order.amount,
          `ऑनलाइन UPI कर्ज परतफेड मंजुरी (${approverTitle}: ${actor.fullName || actor.role})`
        );

        const newTotalRepaid = currentRepaid + order.amount;
        const newOutstanding = targetTotal - newTotalRepaid;
        const newLoanStatus = newOutstanding === 0 ? 'CLOSED' : 'ACTIVE';

        db.prepare(`
          UPDATE loans SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?
        `).run(newLoanStatus, loan.id);

        db.prepare(`
          UPDATE payment_orders
          SET status = 'ONLINE_CONFIRMED',
              approved_by = ?,
              approved_at = CURRENT_TIMESTAMP,
              financial_transaction_id = ?,
              completed_at = CURRENT_TIMESTAMP,
              updated_at = CURRENT_TIMESTAMP
          WHERE id = ?
        `).run(actor.id, transactionId, order.id);

        // Audit log
        db.prepare(`
          INSERT INTO audit_logs (id, organization_id, user_id, action, details, ip_address)
          VALUES (?, ?, ?, 'ONLINE_LOAN_REPAYMENT_APPROVED', ?, ?)
        `).run(
          crypto.randomUUID(),
          orgId,
          actor.id,
          JSON.stringify({
            orderId: order.id,
            loanId: loan.id,
            memberId: order.member_id,
            amount: order.amount,
            transactionId,
            transactionNumber,
            newOutstanding,
            approvedByRole: actor.role,
          }),
          ipAddress
        );

        db.exec('COMMIT;');

        NotificationService.sendNotification({
          organizationId: orgId,
          userId: order.member_id,
          type: 'LOAN_REPAYMENT',
          title: 'ऑनलाइन कर्ज परतफेड मंजूर',
          message: `₹${order.amount} चा ऑनलाइन कर्ज भरणा मंजूर झाला आहे. उर्वरित बाकी: ₹${newOutstanding}. पावती क्र: ${transactionNumber}`,
          entityType: 'LOAN',
          entityId: loan.id,
          idempotencyKey: `loan-online-approved-${transactionNumber}`,
          data: { transactionId, transactionNumber, amount: order.amount, paymentMethod: 'ONLINE' },
        }).catch((err) => console.error('Notification error (approve online loan member):', err));

        return {
          success: true,
          transactionId,
          transactionNumber,
          receiptNumber: `RCP-${transactionNumber.replace(/^TXN-/, '')}`,
          bishiMonth: '',
          amount: order.amount,
          paymentMethod: 'ONLINE',
        };
      }

      // ==========================================
      // Case B: Online Bishi Payment Order
      // ==========================================
      const bishi = db
        .prepare(`
          SELECT r.*, u.full_name as member_name
          FROM bishi_records r
          INNER JOIN users u ON r.member_id = u.id AND r.organization_id = u.organization_id
          WHERE r.id = ? AND r.organization_id = ?
        `)
        .get(order.bishi_record_id, orgId) as any;

      if (!bishi) {
        throw new AppError('मासिक बीसी नोंद सापडली नाही (Bishi record not found)', 404);
      }

      if (bishi.status === 'PAID') {
        throw new AppError('हा बीसी हप्ता आधीच भरला गेला आहे (Already paid)', 409);
      }

      const transactionId = crypto.randomUUID();
      const transactionNumber = LedgerService.generateTransactionNumber();

      // 1. Insert into financial_transactions
      db.prepare(`
        INSERT INTO financial_transactions (
          id, organization_id, member_id, actor_id, transaction_type,
          reference_id, transaction_number, amount, payment_method,
          transaction_date, status, notes
        ) VALUES (?, ?, ?, ?, 'BISHI_PAYMENT', ?, ?, ?, 'ONLINE', CURRENT_TIMESTAMP, 'CONFIRMED', ?)
      `).run(
        transactionId,
        orgId,
        order.member_id,
        actor.id,
        order.bishi_record_id,
        transactionNumber,
        order.amount,
        `ऑनलाइन UPI भरणा मंजुरी (${approverTitle}: ${actor.fullName || actor.role})`
      );

      // 2. Update bishi_records to PAID
      db.prepare(`
        UPDATE bishi_records
        SET status = 'PAID',
            paid_amount = ?,
            paid_date = CURRENT_TIMESTAMP,
            payment_method = 'ONLINE',
            payment_transaction_id = ?,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(order.amount, transactionId, order.bishi_record_id);

      // 3. Update payment_orders
      db.prepare(`
        UPDATE payment_orders
        SET status = 'ONLINE_CONFIRMED',
            approved_by = ?,
            approved_at = CURRENT_TIMESTAMP,
            financial_transaction_id = ?,
            completed_at = CURRENT_TIMESTAMP,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(actor.id, transactionId, order.id);

      // 4. Insert audit log
      db.prepare(`
        INSERT INTO audit_logs (id, organization_id, user_id, action, details, ip_address)
        VALUES (?, ?, ?, 'ONLINE_PAYMENT_APPROVED', ?, ?)
      `).run(
        crypto.randomUUID(),
        orgId,
        actor.id,
        JSON.stringify({
          orderId: order.id,
          bishiRecordId: order.bishi_record_id,
          memberId: order.member_id,
          amount: order.amount,
          transactionId,
          transactionNumber,
          monthYear: bishi.month_year,
          approvedByRole: actor.role,
        }),
        ipAddress
      );

      db.exec('COMMIT;');

      // Dispatch notification to Member
      NotificationService.sendNotification({
        organizationId: orgId,
        userId: order.member_id,
        type: 'BISHI_PAID',
        title: 'ऑनलाइन भरणा मंजूर',
        message: `${bishi.month_year} महिन्याचा ₹${order.amount} चा ऑनलाइन भरणा मंजूर झाला आहे. पावती क्र: ${transactionNumber}`,
        entityType: 'BISHI',
        entityId: order.bishi_record_id,
        idempotencyKey: `bishi-online-approved-${transactionNumber}`,
        data: { transactionId, transactionNumber, amount: order.amount, monthYear: bishi.month_year, paymentMethod: 'ONLINE' },
      }).catch((err) => console.error('Notification error (approve online member):', err));

      return {
        success: true,
        transactionId,
        transactionNumber,
        receiptNumber: `RCP-${transactionNumber.replace(/^TXN-/, '')}`,
        bishiMonth: bishi.month_year,
        amount: order.amount,
        paymentMethod: 'ONLINE',
      };
    } catch (err) {
      db.exec('ROLLBACK;');
      throw err;
    }
  }

  /**
   * Rejects an online payment order with officer reason (President & Treasurer only).
   * Cross-officer protection: Self-rejection is strictly forbidden!
   */
  public static rejectOnlinePayment(
    orgId: string,
    actor: AuthenticatedUser,
    orderId: string,
    reason: string,
    ipAddress: string
  ): {
    success: true;
    orderId: string;
    status: 'ONLINE_REJECTED';
    rejectionReason: string;
  } {
    const db = getDatabase();

    db.exec('BEGIN IMMEDIATE TRANSACTION;');
    try {
      const order = db
        .prepare('SELECT * FROM payment_orders WHERE id = ? AND organization_id = ?')
        .get(orderId, orgId) as any;

      if (!order) {
        throw new AppError('पेमेंट ऑर्डर सापडली नाही (Payment order not found)', 404);
      }

      // Self-rejection safeguard
      if (order.member_id === actor.id) {
        throw new AppError(
          'अधिकारी स्वतःच्या खात्याचा भरणा नाकारू शकत नाही. दुसऱ्या अधिकाऱ्याची (अध्यक्ष/खजिनदार) कृती आवश्यक आहे. (Self-rejection not allowed)',
          403
        );
      }

      if (order.status === 'ONLINE_CONFIRMED' || order.status === 'SUCCESS') {
        throw new AppError('हा भरणा आधीच मंजूर झाला आहे, नाकारता येणार नाही (Already confirmed)', 409);
      }

      if (order.status === 'ONLINE_REJECTED') {
        throw new AppError('हा भरणा आधीच नाकारण्यात आला आहे (Already rejected)', 400);
      }

      db.prepare(`
        UPDATE payment_orders
        SET status = 'ONLINE_REJECTED',
            rejected_by = ?,
            rejected_at = CURRENT_TIMESTAMP,
            rejection_reason = ?,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(actor.id, reason, order.id);

      db.prepare(`
        INSERT INTO audit_logs (id, organization_id, user_id, action, details, ip_address)
        VALUES (?, ?, ?, 'ONLINE_PAYMENT_REJECTED', ?, ?)
      `).run(
        crypto.randomUUID(),
        orgId,
        actor.id,
        JSON.stringify({
          orderId: order.id,
          bishiRecordId: order.bishi_record_id,
          loanId: order.loan_id,
          memberId: order.member_id,
          amount: order.amount,
          rejectionReason: reason,
          rejectedByRole: actor.role,
        }),
        ipAddress
      );

      db.exec('COMMIT;');

      NotificationService.sendNotification({
        organizationId: orgId,
        userId: order.member_id,
        type: 'PAYMENT_FAILED',
        title: 'ऑनलाइन भरणा नाकारला',
        message: `आपला ₹${order.amount} चा ऑनलाइन भरणा नाकारण्यात आला आहे. कारण: ${reason}`,
        entityType: 'PAYMENT',
        entityId: order.id,
        idempotencyKey: `payment-rejected-${order.id}`,
        data: { orderId: order.id, amount: order.amount, reason },
      }).catch((err) => console.error('Notification error (reject online member):', err));

      return {
        success: true,
        orderId: order.id,
        status: 'ONLINE_REJECTED',
        rejectionReason: reason,
      };
    } catch (err) {
      db.exec('ROLLBACK;');
      throw err;
    }
  }

  /**
   * Creates a payment order for a member's loan repayment.
   */
  public static async createLoanPaymentOrder(
    orgId: string,
    memberId: string,
    loanId: string,
    amount: number,
    ipAddress: string
  ): Promise<{
    order: PaymentOrder;
    providerKeyId: string;
    memberName: string;
    accountName: string;
    bank: SupportedBank;
    upiIntentUrl?: string;
    upiId?: string | null;
    hasQrCode?: boolean;
    qrCodeData?: string | null;
  }> {
    const db = getDatabase();

    // 1. Verify loan exists, belongs to member, is ACTIVE
    const loan = db
      .prepare(`
        SELECT l.*, u.full_name as member_name
        FROM loans l
        INNER JOIN users u ON l.member_id = u.id AND l.organization_id = u.organization_id
        WHERE l.id = ? AND l.organization_id = ? AND l.member_id = ?
      `)
      .get(loanId, orgId, memberId) as any;

    if (!loan) {
      throw new AppError('कर्ज नोंद सापडली नाही (Loan not found for this member)', 404);
    }

    if (loan.status === 'CLOSED') {
      throw new AppError('हे कर्ज आधीच पूर्ण भरले गेले आहे (Already fully repaid)', 400);
    }

    if (loan.status === 'CANCELLED') {
      throw new AppError('हे कर्ज रद्द करण्यात आले आहे (This loan is cancelled)', 400);
    }

    // Check outstanding
    const sumRow = db
      .prepare(`
        SELECT COALESCE(SUM(amount), 0) as total_repaid
        FROM financial_transactions
        WHERE organization_id = ? AND transaction_type = 'LOAN_REPAYMENT'
          AND reference_id IN (SELECT id FROM loan_repayments WHERE loan_id = ?)
          AND status = 'CONFIRMED'
      `)
      .get(orgId, loanId) as any;

    const currentRepaid = sumRow.total_repaid || 0;
    const targetTotal = loan.total_payable > 0 ? loan.total_payable : loan.amount;
    const outstanding = targetTotal - currentRepaid;

    if (amount <= 0) {
      throw new AppError('परतफेड रक्कम धन असावी (Amount must be strictly positive)', 400);
    }

    if (amount > outstanding) {
      throw new AppError(`परतफेड रक्कम उर्वरित बाकी रकमेपेक्षा (₹${outstanding}) जास्त असू शकत नाही`, 400);
    }

    // 2. Verify Mandal payment config
    const rawConfig = db
      .prepare('SELECT * FROM payment_configs WHERE organization_id = ?')
      .get(orgId) as any;

    if (!rawConfig || !rawConfig.is_active || (rawConfig.status !== 'ACTIVE' && !rawConfig.upi_id && !rawConfig.qr_code_data)) {
      throw new AppError(
        'ऑनलाइन पेमेंट सध्या उपलब्ध नाही. कृपया खजिनदाराकडे रोख रक्कम जमा करा. (Online payment is not active)',
        400
      );
    }

    const bank = (rawConfig.bank || rawConfig.provider || 'SBI') as SupportedBank;
    const merchantUpi = rawConfig.upi_id || rawConfig.merchant_id || '';
    const accountName = rawConfig.account_name || 'NTM Passbook Mandal';

    const orderId = crypto.randomUUID();
    const idempotencyKey = `ord_loan_${crypto.randomUUID()}`;
    const providerOrderId = `prov_${orderId.slice(0, 8)}`;
    let upiIntentUrl: string | undefined;

    if (merchantUpi) {
      upiIntentUrl = `upi://pay?pa=${encodeURIComponent(merchantUpi)}&pn=${encodeURIComponent(accountName)}&am=${amount.toFixed(2)}&tr=${providerOrderId}&cu=INR&tn=${encodeURIComponent('NTM Mandal Loan Repayment')}`;
    }

    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

    db.prepare(`
      INSERT INTO payment_orders (
        id, organization_id, member_id, payment_type, loan_id, amount, currency,
        bank, provider, provider_order_id, status, idempotency_key, expires_at
      ) VALUES (?, ?, ?, 'LOAN_REPAYMENT', ?, ?, 'INR', ?, ?, ?, 'ONLINE_PENDING', ?, ?)
    `).run(
      orderId,
      orgId,
      memberId,
      loanId,
      amount,
      bank,
      bank,
      providerOrderId,
      idempotencyKey,
      expiresAt
    );

    // Audit log
    db.prepare(`
      INSERT INTO audit_logs (id, organization_id, user_id, action, details, ip_address)
      VALUES (?, ?, ?, 'LOAN_PAYMENT_ORDER_CREATED', ?, ?)
    `).run(
      crypto.randomUUID(),
      orgId,
      memberId,
      JSON.stringify({
        orderId,
        loanId,
        amount,
        bank,
      }),
      ipAddress
    );

    // Send notification to President & Treasurer
    NotificationService.sendToRoles(
      orgId,
      ['PRESIDENT', 'TREASURER'],
      {
        type: 'PAYMENT_INITIATED',
        title: 'नवीन कर्ज परतफेड ऑनलाइन भरणा',
        message: `${loan.member_name} यांनी ₹${amount} चा ऑनलाइन कर्ज परतफेड भरणा केल्याची नोंद पाठवली आहे. कृपया पडताळणी करा.`,
        entityType: 'PAYMENT',
        entityId: orderId,
        idempotencyKey: `loan-payment-initiated-officer-${orderId}`,
        data: { orderId, loanId, amount, memberId },
      }
    ).catch((err) => console.error('Notification error (loan payment initiated officer):', err));

    const saved = db.prepare('SELECT * FROM payment_orders WHERE id = ?').get(orderId) as any;

    return {
      order: this.mapOrder({ ...saved, member_name: loan.member_name }),
      providerKeyId: rawConfig.merchant_id || rawConfig.upi_id || bank,
      memberName: loan.member_name,
      accountName,
      bank,
      upiIntentUrl,
      upiId: rawConfig.upi_id || null,
      hasQrCode: Boolean(rawConfig.qr_code_data),
      qrCodeData: rawConfig.qr_code_data || null,
    };
  }

  /**
   * Retrieves order status for client status polling / check
   */
  public static getOrderStatus(
    orgId: string,
    orderId: string,
    actor: AuthenticatedUser
  ): PaymentOrder {
    const db = getDatabase();

    // 1. Look up payment order by order ID
    const order = db
      .prepare(`
        SELECT o.*, u.full_name as member_name, u.phone as member_phone, b.month_year as bishi_month
        FROM payment_orders o
        LEFT JOIN users u ON o.member_id = u.id AND o.organization_id = u.organization_id
        LEFT JOIN bishi_records b ON o.bishi_record_id = b.id AND o.organization_id = b.organization_id
        WHERE o.id = ?
      `)
      .get(orderId) as any;

    // 2. If it does not exist, return existing not-found behavior
    if (!order) {
      throw new AppError('पेमेंट ऑर्डर सापडली नाही (Payment order not found)', 404);
    }

    // 3. Explicit tenant check: If it exists but belongs to another organization, return 403 Forbidden
    if (order.organization_id !== orgId) {
      throw new AppError('दुसऱ्या मंडळाचा तपशील पाहण्यास परवानगी नाही.', 403);
    }

    // 4. IDOR protection: Members can only check their own orders
    if (actor.role === 'MEMBER' && order.member_id !== actor.id) {
      throw new AppError('तुम्हाला इतर सदस्यांची ऑर्डर पाहण्याची परवानगी नाही', 403);
    }

    return this.mapOrder(order);
  }

  /**
   * Lists payment orders with multi-tenant and role-aware filtering.
   * President & Treasurer see all orders for their Mandal.
   * Member only sees their own orders.
   */
  public static listPaymentOrders(
    orgId: string,
    actor: AuthenticatedUser
  ): PaymentOrder[] {
    const db = getDatabase();
    let rows: any[];
    if (actor.role === 'MEMBER') {
      rows = db
        .prepare(`
          SELECT o.*, u.full_name as member_name, u.phone as member_phone, b.month_year as bishi_month
          FROM payment_orders o
          LEFT JOIN users u ON o.member_id = u.id AND o.organization_id = u.organization_id
          LEFT JOIN bishi_records b ON o.bishi_record_id = b.id AND o.organization_id = b.organization_id
          WHERE o.organization_id = ? AND o.member_id = ?
          ORDER BY o.created_at DESC
        `)
        .all(orgId, actor.id) as any[];
    } else {
      rows = db
        .prepare(`
          SELECT o.*, u.full_name as member_name, u.phone as member_phone, b.month_year as bishi_month
          FROM payment_orders o
          LEFT JOIN users u ON o.member_id = u.id AND o.organization_id = u.organization_id
          LEFT JOIN bishi_records b ON o.bishi_record_id = b.id AND o.organization_id = b.organization_id
          WHERE o.organization_id = ?
          ORDER BY o.created_at DESC
        `)
        .all(orgId) as any[];
    }

    return rows.map((order) => this.mapOrder(order));
  }
}

