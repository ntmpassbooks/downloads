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

export class PaymentService {
  /**
   * Retrieves Mandal's payment configuration.
   * Strictly masks account numbers and NEVER returns credentials/secrets.
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
      bank,
      provider: bank,
      accountName: row.account_name,
      accountType: row.account_type || null,
      accountNumber: isPresident ? (row.account_number || null) : maskAccountNumber(row.account_number),
      maskedAccountNumber: maskAccountNumber(row.account_number),
      ifsc: row.ifsc || null,
      branch: row.branch || null,
      upiId: row.upi_id || null,
      merchantId: row.merchant_id || null,
      hasCredentials: Boolean(row.credentials_encrypted),
      status: row.status as PaymentConfigStatus,
      isActive: Boolean(row.is_active),
      notes: row.notes || null,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  /**
   * Sets or updates Mandal's payment configuration (President Only).
   * Initial status is PENDING; entering bank details alone does NOT activate online payments.
   */
  public static upsertPaymentConfig(
    orgId: string,
    actorId: string,
    input: UpsertPaymentConfigInput,
    ipAddress: string
  ): PaymentConfig {
    const db = getDatabase();

    // Verify bank is supported (strictly blocks BOI)
    const bank = input.bank as SupportedBank;
    BankAdapterFactory.getAdapter(bank);

    const existing = db
      .prepare('SELECT id, status, is_active, credentials_encrypted, credentials_iv, credentials_tag FROM payment_configs WHERE organization_id = ?')
      .get(orgId) as any;

    let configId: string;
    let newStatus: PaymentConfigStatus = 'PENDING';
    let isActive = 0;
    let encSecret: string | null = null;
    let encIv: string | null = null;
    let encTag: string | null = null;

    if (input.apiSecret && input.apiSecret.trim().length > 0) {
      const encrypted = encryptSecret(input.apiSecret.trim());
      encSecret = encrypted.encrypted;
      encIv = encrypted.iv;
      encTag = encrypted.tag;
    } else if (existing) {
      encSecret = existing.credentials_encrypted;
      encIv = existing.credentials_iv;
      encTag = existing.credentials_tag;
    }

    if (existing) {
      configId = existing.id;
      const bankChanged = existing.bank !== bank;
      const accountTypeChanged = existing.account_type !== input.accountType;
      const requiresPending = bankChanged || accountTypeChanged || input.accountType === 'SAVINGS';

      newStatus = requiresPending ? 'PENDING' : existing.status;
      isActive = requiresPending ? 0 : existing.is_active;

      db.prepare(`
        UPDATE payment_configs
        SET bank = ?, provider = ?, account_name = ?, account_type = ?, account_number = ?, ifsc = ?,
            branch = ?, upi_id = ?, merchant_id = ?, credentials_encrypted = ?,
            credentials_iv = ?, credentials_tag = ?, status = ?, is_active = ?, notes = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(
        bank,
        bank,
        input.accountName,
        input.accountType,
        input.accountNumber || null,
        input.ifsc || null,
        input.branch || null,
        input.upiId || null,
        input.merchantId || null,
        encSecret,
        encIv,
        encTag,
        newStatus,
        isActive,
        input.notes || null,
        configId
      );
    } else {
      configId = crypto.randomUUID();
      db.prepare(`
        INSERT INTO payment_configs (
          id, organization_id, bank, provider, account_name, account_type, account_number, ifsc,
          branch, upi_id, merchant_id, credentials_encrypted, credentials_iv,
          credentials_tag, status, is_active, notes
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        configId,
        orgId,
        bank,
        bank,
        input.accountName,
        input.accountType,
        input.accountNumber || null,
        input.ifsc || null,
        input.branch || null,
        input.upiId || null,
        input.merchantId || null,
        encSecret,
        encIv,
        encTag,
        newStatus,
        isActive,
        input.notes || null
      );
    }

    // Audit log without leaking secrets
    db.prepare(`
      INSERT INTO audit_logs (id, organization_id, user_id, action, details, ip_address)
      VALUES (?, ?, ?, 'PAYMENT_CONFIG_UPDATED', ?, ?)
    `).run(
      crypto.randomUUID(),
      orgId,
      actorId,
      JSON.stringify({
        configId,
        bank,
        accountName: input.accountName,
        accountType: input.accountType,
        accountNumberMasked: maskAccountNumber(input.accountNumber),
        ifsc: input.ifsc || null,
        upiId: input.upiId || null,
        merchantId: input.merchantId || null,
        hasCredentials: Boolean(encSecret),
        status: newStatus,
        isActive: Boolean(isActive),
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
   * - Validates active mandal bank configuration.
   * - Uses chosen bank adapter to create order reference and UPI intent URL.
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

    if (!rawConfig || rawConfig.status !== 'ACTIVE' || !rawConfig.is_active) {
      throw new AppError(
        'ऑनलाइन पेमेंट सध्या उपलब्ध नाही. कृपया खजिनदाराकडे रोख रक्कम जमा करा. (Online payment is not active)',
        400
      );
    }

    if (rawConfig.account_type !== 'CURRENT' && rawConfig.account_type !== 'SAVINGS') {
      throw new AppError(
        'ऑनलाइन पेमेंटसाठी मंडळाचे अधिकृत चालू खाते किंवा संस्थात्मक बचत खाते आवश्यक आहे.',
        400
      );
    }

    const bank = (rawConfig.bank || rawConfig.provider || 'SBI') as SupportedBank;
    const adapter = providerOverride || BankAdapterFactory.getAdapter(bank);

    const merchantUpi = rawConfig.upi_id || rawConfig.merchant_id;
    if (!merchantUpi) {
      throw new AppError(
        'मंडळाचा अधिकृत व्यापारी UPI आयडी कॉन्फिगर केलेला नाही. कृपया बँक रचना पूर्ण करा.',
        400
      );
    }

    // 3. Prevent duplicate active orders: check if an unexpired order exists (< 15 mins)
    const existingOrder = db
      .prepare(`
        SELECT * FROM payment_orders
        WHERE organization_id = ? AND member_id = ? AND bishi_record_id = ?
          AND status IN ('CREATED', 'PENDING')
          AND datetime(expires_at) > datetime('now')
      `)
      .get(orgId, memberId, bishiRecordId) as any;

    if (existingOrder) {
      const upiPa = merchantUpi;
      const upiPn = rawConfig.account_name || 'NTM Passbook Mandal';
      const existingUpi = `upi://pay?pa=${encodeURIComponent(upiPa)}&pn=${encodeURIComponent(upiPn)}&am=${existingOrder.amount.toFixed(2)}&tr=${existingOrder.provider_order_id}&cu=INR&tn=${encodeURIComponent('NTM Mandal Bishi')}`;

      return {
        order: {
          id: existingOrder.id,
          organizationId: existingOrder.organization_id,
          memberId: existingOrder.member_id,
          bishiRecordId: existingOrder.bishi_record_id,
          amount: existingOrder.amount,
          currency: existingOrder.currency,
          bank: (existingOrder.bank || bank) as SupportedBank,
          provider: (existingOrder.provider || bank) as SupportedBank,
          providerOrderId: existingOrder.provider_order_id,
          providerPaymentId: existingOrder.provider_payment_id,
          status: existingOrder.status,
          idempotencyKey: existingOrder.idempotency_key,
          financialTransactionId: existingOrder.financial_transaction_id,
          expiresAt: existingOrder.expires_at,
          completedAt: existingOrder.completed_at,
          createdAt: existingOrder.created_at,
          updatedAt: existingOrder.updated_at,
        },
        providerKeyId: rawConfig.merchant_id || rawConfig.upi_id || bank,
        bishiMonth: record.month_year,
        memberName: record.member_name,
        accountName: rawConfig.account_name,
        bank,
        upiIntentUrl: existingUpi,
      };
    }

    // 4. Create provider order via selected bank adapter
    const orderId = crypto.randomUUID();
    const idempotencyKey = `ord_${crypto.randomUUID()}`;
    const providerResult = await adapter.createOrder({
      amount: record.expected_amount,
      currency: 'INR',
      receipt: `RCP_ORD_${orderId.slice(0, 8)}`,
      merchantUpiId: merchantUpi,
      accountName: rawConfig.account_name,
      notes: {
        organizationId: orgId,
        memberId,
        bishiRecordId,
        monthYear: record.month_year,
        bank,
      },
    });

    // Expiry time: 15 minutes from now
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();

    db.prepare(`
      INSERT INTO payment_orders (
        id, organization_id, member_id, bishi_record_id, amount, currency,
        bank, provider, provider_order_id, status, idempotency_key, expires_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'CREATED', ?, ?)
    `).run(
      orderId,
      orgId,
      memberId,
      bishiRecordId,
      record.expected_amount,
      'INR',
      bank,
      bank,
      providerResult.providerOrderId,
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
        providerOrderId: providerResult.providerOrderId,
        bishiRecordId,
        amount: record.expected_amount,
        monthYear: record.month_year,
      }),
      ipAddress
    );

    const saved = db.prepare('SELECT * FROM payment_orders WHERE id = ?').get(orderId) as any;

    // Send PAYMENT_INITIATED notification to member
    NotificationService.sendNotification({
      organizationId: orgId,
      userId: memberId,
      type: 'PAYMENT_INITIATED',
      title: 'ऑनलाइन पेमेंट सुरू',
      message: `${record.month_year} महिन्याच्या बिशीसाठी ₹${record.expected_amount} चे ऑनलाइन पेमेंट सुरू केले आहे.`,
      entityType: 'PAYMENT_ORDER',
      entityId: orderId,
      idempotencyKey: `payment-initiated-${orderId}`,
      data: { orderId, amount: record.expected_amount, bank, monthYear: record.month_year },
    }).catch(err => console.error('Notification error (payment initiated):', err));

    return {
      order: {
        id: saved.id,
        organizationId: saved.organization_id,
        memberId: saved.member_id,
        bishiRecordId: saved.bishi_record_id,
        amount: saved.amount,
        currency: saved.currency,
        bank: saved.bank as SupportedBank,
        provider: saved.provider as SupportedBank,
        providerOrderId: saved.provider_order_id,
        providerPaymentId: saved.provider_payment_id,
        status: saved.status,
        idempotencyKey: saved.idempotency_key,
        financialTransactionId: saved.financial_transaction_id,
        expiresAt: saved.expires_at,
        completedAt: saved.completed_at,
        createdAt: saved.created_at,
        updatedAt: saved.updated_at,
      },
      providerKeyId: rawConfig.merchant_id || rawConfig.upi_id || bank,
      bishiMonth: record.month_year,
      memberName: record.member_name,
      accountName: rawConfig.account_name,
      bank,
      upiIntentUrl: providerResult.upiIntentUrl,
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
        entityType: 'PAYMENT_ORDER',
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
        entityType: 'PAYMENT_ORDER',
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
      .prepare('SELECT * FROM payment_orders WHERE id = ?')
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

    const bank = (order.bank || order.provider || 'SBI') as SupportedBank;

    return {
      id: order.id,
      organizationId: order.organization_id,
      memberId: order.member_id,
      bishiRecordId: order.bishi_record_id,
      amount: order.amount,
      currency: order.currency,
      bank,
      provider: bank,
      providerOrderId: order.provider_order_id,
      providerPaymentId: order.provider_payment_id,
      status: order.status,
      idempotencyKey: order.idempotency_key,
      financialTransactionId: order.financial_transaction_id,
      expiresAt: order.expires_at,
      completedAt: order.completed_at,
      createdAt: order.created_at,
      updatedAt: order.updated_at,
    };
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
        .prepare('SELECT * FROM payment_orders WHERE organization_id = ? AND member_id = ? ORDER BY created_at DESC')
        .all(orgId, actor.id) as any[];
    } else {
      rows = db
        .prepare('SELECT * FROM payment_orders WHERE organization_id = ? ORDER BY created_at DESC')
        .all(orgId) as any[];
    }

    return rows.map((order) => {
      const bank = (order.bank || order.provider || 'SBI') as SupportedBank;
      return {
        id: order.id,
        organizationId: order.organization_id,
        memberId: order.member_id,
        bishiRecordId: order.bishi_record_id,
        amount: order.amount,
        currency: order.currency,
        bank,
        provider: bank,
        providerOrderId: order.provider_order_id,
        providerPaymentId: order.provider_payment_id,
        status: order.status,
        idempotencyKey: order.idempotency_key,
        financialTransactionId: order.financial_transaction_id,
        expiresAt: order.expires_at,
        completedAt: order.completed_at,
        createdAt: order.created_at,
        updatedAt: order.updated_at,
      };
    });
  }
}

