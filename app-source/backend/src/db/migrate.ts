import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getDatabase, closeDatabase } from './connection.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export function runMigrations(): void {
  const db = getDatabase();
  let schemaPath = path.resolve(__dirname, 'schema.sql');
  if (!fs.existsSync(schemaPath)) {
    schemaPath = path.resolve(__dirname, '../../src/db/schema.sql');
  }
  if (!fs.existsSync(schemaPath)) {
    schemaPath = path.resolve(process.cwd(), 'src/db/schema.sql');
  }
  const sql = fs.readFileSync(schemaPath, 'utf8');

  console.log('🔄 Running database migrations...');

  // Ensure financial_transactions supports LOAN_DISBURSED and LOAN_REPAYMENT
  try {
    const txnTable = db
      .prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'financial_transactions'")
      .get() as { sql: string } | undefined;

    if (txnTable && !txnTable.sql.includes('ONLINE_UPI')) {
      console.log('🔄 Migrating financial_transactions to support ONLINE_UPI...');
      db.exec('PRAGMA foreign_keys = OFF;');
      db.exec(`
        CREATE TABLE financial_transactions_new (
          id TEXT PRIMARY KEY,
          organization_id TEXT NOT NULL,
          member_id TEXT,
          actor_id TEXT NOT NULL,
          transaction_type TEXT NOT NULL CHECK(transaction_type IN ('BISHI_PAYMENT', 'LOAN_DISBURSED', 'LOAN_REPAYMENT', 'EXPENSE')),
          reference_id TEXT NOT NULL,
          transaction_number TEXT UNIQUE NOT NULL,
          amount INTEGER NOT NULL CHECK (amount > 0),
          payment_method TEXT NOT NULL CHECK(payment_method IN ('CASH', 'ONLINE_UPI')) DEFAULT 'CASH',
          transaction_date DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          status TEXT NOT NULL CHECK(status IN ('CONFIRMED', 'CANCELLED')) DEFAULT 'CONFIRMED',
          notes TEXT,
          created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE,
          FOREIGN KEY (member_id) REFERENCES users(id) ON DELETE CASCADE,
          FOREIGN KEY (actor_id) REFERENCES users(id) ON DELETE RESTRICT,
          UNIQUE (organization_id, reference_id)
        );

        INSERT INTO financial_transactions_new (id, organization_id, member_id, actor_id, transaction_type, reference_id, transaction_number, amount, payment_method, transaction_date, status, notes, created_at)
        SELECT id, organization_id, member_id, actor_id, transaction_type, reference_id, transaction_number, amount, payment_method, transaction_date, status, notes, created_at FROM financial_transactions;
        DROP TABLE financial_transactions;
        ALTER TABLE financial_transactions_new RENAME TO financial_transactions;

        CREATE INDEX IF NOT EXISTS idx_fin_txns_org ON financial_transactions(organization_id);
        CREATE INDEX IF NOT EXISTS idx_fin_txns_member ON financial_transactions(member_id);
        CREATE INDEX IF NOT EXISTS idx_fin_txns_ref ON financial_transactions(reference_id);
        CREATE INDEX IF NOT EXISTS idx_fin_txns_date ON financial_transactions(transaction_date DESC, created_at DESC);
        CREATE INDEX IF NOT EXISTS idx_fin_txns_number ON financial_transactions(transaction_number);
      `);
      db.exec('PRAGMA foreign_keys = ON;');
      console.log('✅ financial_transactions table migrated successfully.');
    }
  } catch (err) {
    console.error('Migration warning for financial_transactions:', err);
  }

  // Pre-schema check: ensure payment_orders and loans have Phase 19 columns before schema.sql runs indexes
  try {
    const poCols = db.prepare("PRAGMA table_info(payment_orders)").all() as Array<{ name: string }>;
    if (poCols.length > 0) {
      const colNames = new Set(poCols.map((c) => c.name));
      if (!colNames.has('payment_type')) {
        db.exec("ALTER TABLE payment_orders ADD COLUMN payment_type TEXT NOT NULL DEFAULT 'BISHI';");
      }
      if (!colNames.has('loan_id')) {
        db.exec('ALTER TABLE payment_orders ADD COLUMN loan_id TEXT;');
      }
    }
  } catch {}

  try {
    const loanCols = db.prepare("PRAGMA table_info(loans)").all() as Array<{ name: string }>;
    if (loanCols.length > 0) {
      const colNames = new Set(loanCols.map((c) => c.name));
      const requiredLoanCols: Record<string, string> = {
        interest_type: "TEXT NOT NULL DEFAULT 'FLAT'",
        rate_period: "TEXT NOT NULL DEFAULT 'ANNUAL'",
        tenure_months: 'INTEGER NOT NULL DEFAULT 1',
        monthly_installment: 'INTEGER NOT NULL DEFAULT 0',
        total_interest: 'INTEGER NOT NULL DEFAULT 0',
        total_payable: 'INTEGER NOT NULL DEFAULT 0',
        first_due_date: 'TEXT',
      };
      for (const [col, colDef] of Object.entries(requiredLoanCols)) {
        if (!colNames.has(col)) {
          db.exec(`ALTER TABLE loans ADD COLUMN ${col} ${colDef};`);
        }
      }
    }
  } catch {}

  db.exec(sql);

  // Ensure payment_transaction_id column exists on bishi_records for existing tables
  try {
    const cols = db.prepare("PRAGMA table_info(bishi_records)").all() as Array<{ name: string }>;
    if (cols.length > 0 && !cols.some((c) => c.name === 'payment_transaction_id')) {
      db.exec('ALTER TABLE bishi_records ADD COLUMN payment_transaction_id TEXT;');
    }
  } catch {
    // bishi_records table might not exist in some early migration stages
  }

  // Ensure encrypted_pin, pin_iv, pin_auth_tag, pin_key_version exist on users table
  try {
    const userCols = db.prepare("PRAGMA table_info(users)").all() as Array<{ name: string }>;
    if (userCols.length > 0) {
      if (!userCols.some((c) => c.name === 'encrypted_pin')) {
        db.exec('ALTER TABLE users ADD COLUMN encrypted_pin TEXT;');
      }
      if (!userCols.some((c) => c.name === 'pin_iv')) {
        db.exec('ALTER TABLE users ADD COLUMN pin_iv TEXT;');
      }
      if (!userCols.some((c) => c.name === 'pin_auth_tag')) {
        db.exec('ALTER TABLE users ADD COLUMN pin_auth_tag TEXT;');
      }
      if (!userCols.some((c) => c.name === 'pin_key_version')) {
        db.exec('ALTER TABLE users ADD COLUMN pin_key_version INTEGER DEFAULT 1;');
      }
    }
  } catch (err) {
    console.error('Migration warning for users table columns:', err);
  }

  // Ensure payment_configs supports multi-bank architecture
  try {
    const pcfgTable = db
      .prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'payment_configs'")
      .get() as { sql: string } | undefined;

    if (pcfgTable && pcfgTable.sql.includes('RAZORPAY') && !pcfgTable.sql.includes('qr_code_data')) {
      console.log('🔄 Migrating payment_configs to multi-bank architecture...');
      db.exec('PRAGMA foreign_keys = OFF;');
      db.exec(`
        CREATE TABLE IF NOT EXISTS payment_configs_new (
          id TEXT PRIMARY KEY,
          organization_id TEXT NOT NULL UNIQUE,
          bank TEXT NOT NULL CHECK(bank IN ('SBI', 'ICICI', 'AXIS', 'AU', 'KOTAK', 'MOCK')),
          provider TEXT NOT NULL CHECK(provider IN ('SBI', 'ICICI', 'AXIS', 'AU', 'KOTAK', 'MOCK')),
          account_name TEXT NOT NULL,
          account_number TEXT,
          ifsc TEXT,
          branch TEXT,
          upi_id TEXT,
          merchant_id TEXT,
          credentials_encrypted TEXT,
          credentials_iv TEXT,
          credentials_tag TEXT,
          status TEXT NOT NULL CHECK(status IN ('NOT_CONFIGURED', 'PENDING', 'ACTIVE', 'FAILED', 'DISABLED')) DEFAULT 'PENDING',
          is_active INTEGER NOT NULL DEFAULT 0 CHECK(is_active IN (0, 1)),
          notes TEXT,
          created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE
        );

        INSERT INTO payment_configs_new (id, organization_id, bank, provider, account_name, merchant_id, status, is_active, notes, created_at, updated_at)
        SELECT id, organization_id, 'SBI', 'SBI', account_name, merchant_id,
          CASE WHEN status = 'VERIFICATION' THEN 'PENDING' ELSE status END,
          is_active, notes, created_at, updated_at
        FROM payment_configs;

        DROP TABLE payment_configs;
        ALTER TABLE payment_configs_new RENAME TO payment_configs;
        CREATE INDEX IF NOT EXISTS idx_payment_configs_org ON payment_configs(organization_id);
      `);
      db.exec('PRAGMA foreign_keys = ON;');
      console.log('✅ payment_configs table migrated to multi-bank architecture.');
    }
  } catch (err) {
    console.error('Migration warning for payment_configs:', err);
  }

  // Ensure payment_configs supports account_type column
  try {
    const pcfgCols = db.prepare("PRAGMA table_info(payment_configs)").all() as Array<{ name: string }>;
    if (pcfgCols.length > 0 && !pcfgCols.some((c) => c.name === 'account_type')) {
      db.exec("ALTER TABLE payment_configs ADD COLUMN account_type TEXT;");
      console.log('✅ Added account_type column to payment_configs table.');
    }
  } catch (err) {
    console.error('Migration warning for payment_configs account_type:', err);
  }

  // Ensure payment_orders supports bank column
  try {
    const orderCols = db.prepare("PRAGMA table_info(payment_orders)").all() as Array<{ name: string }>;
    if (orderCols.length > 0 && !orderCols.some((c) => c.name === 'bank')) {
      db.exec("ALTER TABLE payment_orders ADD COLUMN bank TEXT NOT NULL DEFAULT 'SBI';");
    }
  } catch {
    // payment_orders might not exist yet
  }

  // Ensure notifications table exists
  try {
    const notifTable = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='notifications'").get();
    if (!notifTable) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS notifications (
          id TEXT PRIMARY KEY,
          organization_id TEXT NOT NULL,
          user_id TEXT NOT NULL,
          type TEXT NOT NULL CHECK(type IN (
            'BISHI_DUE', 'BISHI_DUE_TODAY', 'BISHI_OVERDUE', 'BISHI_PAID',
            'PAYMENT_INITIATED', 'PAYMENT_PENDING', 'PAYMENT_VERIFIED', 'PAYMENT_FAILED', 'PAYMENT_CANCELLED', 'PAYMENT_EXPIRED',
            'LOAN_DISBURSED', 'LOAN_REPAYMENT', 'LOAN_REMINDER',
            'FINANCIAL_EVENT', 'SECURITY_EVENT'
          )),
          title TEXT NOT NULL,
          message TEXT NOT NULL,
          entity_type TEXT CHECK(entity_type IN ('BISHI', 'PAYMENT', 'LOAN', 'EXPENSE', 'SECURITY', 'SYSTEM')),
          entity_id TEXT,
          is_read INTEGER NOT NULL DEFAULT 0 CHECK(is_read IN (0, 1)),
          read_at DATETIME,
          idempotency_key TEXT UNIQUE,
          data_json TEXT,
          created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE,
          FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        );
        CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id, created_at DESC);
        CREATE INDEX IF NOT EXISTS idx_notifications_user_unread ON notifications(user_id, is_read);
        CREATE INDEX IF NOT EXISTS idx_notifications_org ON notifications(organization_id);
        CREATE INDEX IF NOT EXISTS idx_notifications_idempotency ON notifications(idempotency_key);
      `);
      console.log('✅ notifications table created successfully.');
    }
  } catch (err) {
    console.error('Migration warning for notifications table:', err);
  }

  // Ensure device_tokens table exists
  try {
    const tokenTable = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='device_tokens'").get();
    if (!tokenTable) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS device_tokens (
          id TEXT PRIMARY KEY,
          organization_id TEXT NOT NULL,
          user_id TEXT NOT NULL,
          device_token TEXT NOT NULL,
          platform TEXT NOT NULL CHECK(platform IN ('ANDROID', 'IOS', 'WEB')),
          device_name TEXT,
          is_active INTEGER NOT NULL DEFAULT 1 CHECK(is_active IN (0, 1)),
          created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          last_used_at DATETIME,
          FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE,
          FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
          UNIQUE(user_id, device_token)
        );
        CREATE INDEX IF NOT EXISTS idx_device_tokens_user ON device_tokens(user_id, is_active);
        CREATE INDEX IF NOT EXISTS idx_device_tokens_org ON device_tokens(organization_id);
      `);
      console.log('✅ device_tokens table created successfully.');
    }
  } catch (err) {
    console.error('Migration warning for device_tokens table:', err);
  }

  // Batch 16: Final Mandal Bishi Payment System Upgrade (UPI ID & QR Code + Manual Approval)
  // 1. Ensure payment_configs supports UPI / QR architecture as well as backward-compatible fields
  try {
    const pcfgCols = db.prepare("PRAGMA table_info(payment_configs)").all() as Array<{ name: string }>;
    if (pcfgCols.length > 0) {
      const colNames = new Set(pcfgCols.map((c) => c.name));
      const requiredCols: Record<string, string> = {
        upi_id: 'TEXT',
        qr_code_data: 'TEXT',
        bank: 'TEXT',
        provider: 'TEXT',
        account_name: 'TEXT',
        account_type: 'TEXT',
        account_number: 'TEXT',
        ifsc: 'TEXT',
        branch: 'TEXT',
        merchant_id: 'TEXT',
        credentials_encrypted: 'TEXT',
        credentials_iv: 'TEXT',
        credentials_tag: 'TEXT',
        status: "TEXT DEFAULT 'PENDING'",
        notes: 'TEXT',
      };
      for (const [col, colDef] of Object.entries(requiredCols)) {
        if (!colNames.has(col)) {
          db.exec(`ALTER TABLE payment_configs ADD COLUMN ${col} ${colDef};`);
          console.log(`✅ Added column ${col} to payment_configs table.`);
        }
      }
    }
  } catch (err) {
    console.error('Migration warning for payment_configs Batch 16:', err);
  }

  // 2. Ensure payment_orders supports manual approval & rejection fields, legacy provider fields, and ONLINE_PENDING status
  try {
    const orderCols = db.prepare("PRAGMA table_info(payment_orders)").all() as Array<{ name: string }>;
    if (orderCols.length > 0) {
      const colNames = new Set(orderCols.map((c) => c.name));
      const requiredCols: Record<string, string> = {
        approved_by: 'TEXT',
        approved_at: 'DATETIME',
        rejected_by: 'TEXT',
        rejected_at: 'DATETIME',
        rejection_reason: 'TEXT',
        provider: 'TEXT',
        bank: 'TEXT',
        provider_order_id: 'TEXT',
        provider_payment_id: 'TEXT',
        expires_at: 'DATETIME',
        completed_at: 'DATETIME',
        notes: 'TEXT',
      };
      for (const [col, colDef] of Object.entries(requiredCols)) {
        if (!colNames.has(col)) {
          db.exec(`ALTER TABLE payment_orders ADD COLUMN ${col} ${colDef};`);
          console.log(`✅ Added column ${col} to payment_orders table.`);
        }
      }
    }

    const orderTable = db
      .prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'payment_orders'")
      .get() as { sql: string } | undefined;

    if (orderTable && !orderTable.sql.includes('ONLINE_PENDING')) {
      console.log('🔄 Migrating payment_orders to manual approval architecture...');
      db.exec('PRAGMA foreign_keys = OFF;');
      db.exec(`
        CREATE TABLE IF NOT EXISTS payment_orders_v3 (
          id TEXT PRIMARY KEY,
          organization_id TEXT NOT NULL,
          member_id TEXT NOT NULL,
          bishi_record_id TEXT NOT NULL,
          amount INTEGER NOT NULL CHECK (amount > 0),
          currency TEXT NOT NULL DEFAULT 'INR',
          bank TEXT,
          provider TEXT,
          provider_order_id TEXT,
          provider_payment_id TEXT,
          status TEXT NOT NULL CHECK(status IN ('ONLINE_PENDING', 'ONLINE_CONFIRMED', 'ONLINE_REJECTED', 'CREATED', 'PENDING', 'SUCCESS', 'FAILED', 'CANCELLED', 'EXPIRED')) DEFAULT 'ONLINE_PENDING',
          idempotency_key TEXT UNIQUE NOT NULL,
          financial_transaction_id TEXT UNIQUE,
          approved_by TEXT,
          approved_at DATETIME,
          rejected_by TEXT,
          rejected_at DATETIME,
          rejection_reason TEXT,
          notes TEXT,
          expires_at DATETIME,
          completed_at DATETIME,
          created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE,
          FOREIGN KEY (member_id) REFERENCES users(id) ON DELETE CASCADE,
          FOREIGN KEY (bishi_record_id) REFERENCES bishi_records(id) ON DELETE CASCADE,
          FOREIGN KEY (financial_transaction_id) REFERENCES financial_transactions(id) ON DELETE SET NULL,
          FOREIGN KEY (approved_by) REFERENCES users(id) ON DELETE SET NULL,
          FOREIGN KEY (rejected_by) REFERENCES users(id) ON DELETE SET NULL
        );

        INSERT INTO payment_orders_v3 (id, organization_id, member_id, bishi_record_id, amount, currency, status, idempotency_key, financial_transaction_id, created_at, updated_at)
        SELECT id, organization_id, member_id, bishi_record_id, amount, currency, status, idempotency_key, financial_transaction_id, created_at, updated_at
        FROM payment_orders;

        DROP TABLE payment_orders;
        ALTER TABLE payment_orders_v3 RENAME TO payment_orders;
        CREATE INDEX IF NOT EXISTS idx_payment_orders_org ON payment_orders(organization_id);
        CREATE INDEX IF NOT EXISTS idx_payment_orders_member ON payment_orders(member_id);
        CREATE INDEX IF NOT EXISTS idx_payment_orders_bishi ON payment_orders(bishi_record_id);
      `);
      db.exec('PRAGMA foreign_keys = ON;');
      console.log('✅ payment_orders table migrated to manual approval architecture.');
    }
  } catch (err) {
    console.error('Migration warning for payment_orders Batch 16:', err);
  }

  // 3. Ensure financial_transactions supports payment_method 'ONLINE'
  try {
    const ftTable = db
      .prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'financial_transactions'")
      .get() as { sql: string } | undefined;

    if (ftTable && !ftTable.sql.includes("'ONLINE'")) {
      console.log('🔄 Migrating financial_transactions to support ONLINE payment_method...');
      db.exec('PRAGMA foreign_keys = OFF;');
      db.exec(`
        CREATE TABLE IF NOT EXISTS financial_transactions_v3 (
          id TEXT PRIMARY KEY,
          organization_id TEXT NOT NULL,
          member_id TEXT,
          actor_id TEXT NOT NULL,
          transaction_type TEXT NOT NULL CHECK(transaction_type IN ('BISHI_PAYMENT', 'LOAN_DISBURSED', 'LOAN_REPAYMENT', 'EXPENSE')),
          reference_id TEXT NOT NULL,
          transaction_number TEXT UNIQUE NOT NULL,
          amount INTEGER NOT NULL CHECK (amount > 0),
          payment_method TEXT NOT NULL CHECK(payment_method IN ('CASH', 'ONLINE', 'ONLINE_UPI')) DEFAULT 'CASH',
          transaction_date DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          status TEXT NOT NULL CHECK(status IN ('CONFIRMED', 'CANCELLED')) DEFAULT 'CONFIRMED',
          notes TEXT,
          created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE,
          FOREIGN KEY (member_id) REFERENCES users(id) ON DELETE CASCADE,
          FOREIGN KEY (actor_id) REFERENCES users(id) ON DELETE RESTRICT,
          UNIQUE (organization_id, reference_id)
        );

        INSERT INTO financial_transactions_v3 SELECT * FROM financial_transactions;
        DROP TABLE financial_transactions;
        ALTER TABLE financial_transactions_v3 RENAME TO financial_transactions;
        CREATE INDEX IF NOT EXISTS idx_fin_txns_org ON financial_transactions(organization_id);
        CREATE INDEX IF NOT EXISTS idx_fin_txns_member ON financial_transactions(member_id);
        CREATE INDEX IF NOT EXISTS idx_fin_txns_ref ON financial_transactions(reference_id);
        CREATE INDEX IF NOT EXISTS idx_fin_txns_date ON financial_transactions(transaction_date DESC, created_at DESC);
        CREATE INDEX IF NOT EXISTS idx_fin_txns_number ON financial_transactions(transaction_number);
      `);
      db.exec('PRAGMA foreign_keys = ON;');
      console.log('✅ financial_transactions table migrated to support ONLINE payment_method.');
    }
  } catch (err) {
    console.error('Migration warning for financial_transactions Batch 16:', err);
  }

  // Phase 19: Comprehensive Professional Reports, EMI Loan System & Online Repayment
  // 1. Upgrade loans table with interest terms, tenure, and EMI attributes
  try {
    const loanCols = db.prepare("PRAGMA table_info(loans)").all() as Array<{ name: string }>;
    if (loanCols.length > 0) {
      const colNames = new Set(loanCols.map((c) => c.name));
      const requiredLoanCols: Record<string, string> = {
        interest_type: "TEXT NOT NULL DEFAULT 'FLAT'",
        rate_period: "TEXT NOT NULL DEFAULT 'ANNUAL'",
        tenure_months: 'INTEGER NOT NULL DEFAULT 1',
        monthly_installment: 'INTEGER NOT NULL DEFAULT 0',
        total_interest: 'INTEGER NOT NULL DEFAULT 0',
        total_payable: 'INTEGER NOT NULL DEFAULT 0',
        first_due_date: 'TEXT',
      };
      for (const [col, colDef] of Object.entries(requiredLoanCols)) {
        if (!colNames.has(col)) {
          db.exec(`ALTER TABLE loans ADD COLUMN ${col} ${colDef};`);
          console.log(`✅ Added column ${col} to loans table.`);
        }
      }
    }
  } catch (err) {
    console.error('Migration warning for loans Phase 19:', err);
  }

  // 2. Ensure loan_installments table exists
  try {
    const installmentTable = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='loan_installments'").get();
    if (!installmentTable) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS loan_installments (
          id TEXT PRIMARY KEY,
          organization_id TEXT NOT NULL,
          loan_id TEXT NOT NULL,
          installment_number INTEGER NOT NULL,
          due_date TEXT NOT NULL,
          principal_amount INTEGER NOT NULL,
          interest_amount INTEGER NOT NULL,
          total_amount INTEGER NOT NULL,
          paid_amount INTEGER NOT NULL DEFAULT 0,
          paid_date DATETIME,
          status TEXT NOT NULL CHECK(status IN ('UPCOMING', 'DUE', 'PARTIALLY_PAID', 'PAID', 'OVERDUE')) DEFAULT 'UPCOMING',
          created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE,
          FOREIGN KEY (loan_id) REFERENCES loans(id) ON DELETE CASCADE,
          UNIQUE(loan_id, installment_number)
        );
        CREATE INDEX IF NOT EXISTS idx_loan_installments_org ON loan_installments(organization_id);
        CREATE INDEX IF NOT EXISTS idx_loan_installments_loan ON loan_installments(loan_id);
        CREATE INDEX IF NOT EXISTS idx_loan_installments_status ON loan_installments(status);
      `);
      console.log('✅ loan_installments table created successfully.');
    }
  } catch (err) {
    console.error('Migration warning for loan_installments table:', err);
  }

  // 3. Upgrade loan_repayments table (allow ONLINE method and add principal/interest breakdown)
  try {
    const lrCols = db.prepare("PRAGMA table_info(loan_repayments)").all() as Array<{ name: string }>;
    if (lrCols.length > 0) {
      const colNames = new Set(lrCols.map((c) => c.name));
      if (!colNames.has('principal_paid')) {
        db.exec('ALTER TABLE loan_repayments ADD COLUMN principal_paid INTEGER NOT NULL DEFAULT 0;');
        console.log('✅ Added principal_paid column to loan_repayments table.');
      }
      if (!colNames.has('interest_paid')) {
        db.exec('ALTER TABLE loan_repayments ADD COLUMN interest_paid INTEGER NOT NULL DEFAULT 0;');
        console.log('✅ Added interest_paid column to loan_repayments table.');
      }
    }

    const lrTable = db
      .prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'loan_repayments'")
      .get() as { sql: string } | undefined;

    if (lrTable && !lrTable.sql.includes("'ONLINE'")) {
      console.log('🔄 Migrating loan_repayments to support ONLINE payment_method...');
      db.exec('PRAGMA foreign_keys = OFF;');
      db.exec(`
        CREATE TABLE IF NOT EXISTS loan_repayments_v2 (
          id TEXT PRIMARY KEY,
          organization_id TEXT NOT NULL,
          loan_id TEXT NOT NULL,
          member_id TEXT NOT NULL,
          actor_id TEXT NOT NULL,
          amount INTEGER NOT NULL CHECK (amount > 0),
          principal_paid INTEGER NOT NULL DEFAULT 0,
          interest_paid INTEGER NOT NULL DEFAULT 0,
          payment_method TEXT NOT NULL CHECK(payment_method IN ('CASH', 'ONLINE')) DEFAULT 'CASH',
          repayment_date DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          transaction_id TEXT UNIQUE,
          notes TEXT,
          created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE,
          FOREIGN KEY (loan_id) REFERENCES loans(id) ON DELETE CASCADE,
          FOREIGN KEY (member_id) REFERENCES users(id) ON DELETE CASCADE,
          FOREIGN KEY (actor_id) REFERENCES users(id) ON DELETE RESTRICT
        );

        INSERT INTO loan_repayments_v2 (id, organization_id, loan_id, member_id, actor_id, amount, principal_paid, interest_paid, payment_method, repayment_date, transaction_id, notes, created_at)
        SELECT id, organization_id, loan_id, member_id, actor_id, amount, COALESCE(principal_paid, amount), COALESCE(interest_paid, 0), payment_method, repayment_date, transaction_id, notes, created_at
        FROM loan_repayments;

        DROP TABLE loan_repayments;
        ALTER TABLE loan_repayments_v2 RENAME TO loan_repayments;
        CREATE INDEX IF NOT EXISTS idx_loan_repayments_org ON loan_repayments(organization_id);
        CREATE INDEX IF NOT EXISTS idx_loan_repayments_loan ON loan_repayments(loan_id);
        CREATE INDEX IF NOT EXISTS idx_loan_repayments_member ON loan_repayments(member_id);
      `);
      db.exec('PRAGMA foreign_keys = ON;');
      console.log('✅ loan_repayments table migrated to support ONLINE payment_method.');
    }
  } catch (err) {
    console.error('Migration warning for loan_repayments Phase 19:', err);
  }

  // 4. Upgrade payment_orders table with payment_type and loan_id and nullable bishi_record_id
  try {
    const poCols = db.prepare("PRAGMA table_info(payment_orders)").all() as Array<{ name: string; notnull: number }>;
    if (poCols.length > 0) {
      const colNames = new Set(poCols.map((c) => c.name));
      if (!colNames.has('payment_type')) {
        db.exec("ALTER TABLE payment_orders ADD COLUMN payment_type TEXT NOT NULL DEFAULT 'BISHI';");
        console.log('✅ Added payment_type column to payment_orders table.');
      }
      if (!colNames.has('loan_id')) {
        db.exec('ALTER TABLE payment_orders ADD COLUMN loan_id TEXT;');
        db.exec('CREATE INDEX IF NOT EXISTS idx_payment_orders_loan ON payment_orders(loan_id);');
        console.log('✅ Added loan_id column to payment_orders table.');
      }

      const bishiCol = poCols.find((c) => c.name === 'bishi_record_id');
      if (bishiCol && bishiCol.notnull === 1) {
        console.log('🔄 Migrating payment_orders to make bishi_record_id nullable...');
        db.exec('PRAGMA foreign_keys = OFF;');
        db.exec(`
          CREATE TABLE IF NOT EXISTS payment_orders_v2 (
            id TEXT PRIMARY KEY,
            organization_id TEXT NOT NULL,
            member_id TEXT NOT NULL,
            payment_type TEXT NOT NULL CHECK(payment_type IN ('BISHI', 'LOAN_REPAYMENT')) DEFAULT 'BISHI',
            bishi_record_id TEXT,
            loan_id TEXT,
            amount INTEGER NOT NULL CHECK (amount > 0),
            currency TEXT NOT NULL DEFAULT 'INR',
            bank TEXT,
            provider TEXT,
            provider_order_id TEXT,
            provider_payment_id TEXT,
            status TEXT NOT NULL CHECK(status IN ('ONLINE_PENDING', 'ONLINE_CONFIRMED', 'ONLINE_REJECTED', 'CREATED', 'PENDING', 'SUCCESS', 'FAILED', 'CANCELLED', 'EXPIRED')) DEFAULT 'ONLINE_PENDING',
            idempotency_key TEXT UNIQUE NOT NULL,
            financial_transaction_id TEXT UNIQUE,
            approved_by TEXT,
            approved_at DATETIME,
            rejected_by TEXT,
            rejected_at DATETIME,
            rejection_reason TEXT,
            notes TEXT,
            expires_at DATETIME,
            completed_at DATETIME,
            created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE,
            FOREIGN KEY (member_id) REFERENCES users(id) ON DELETE CASCADE,
            FOREIGN KEY (bishi_record_id) REFERENCES bishi_records(id) ON DELETE CASCADE,
            FOREIGN KEY (loan_id) REFERENCES loans(id) ON DELETE CASCADE,
            FOREIGN KEY (financial_transaction_id) REFERENCES financial_transactions(id) ON DELETE SET NULL,
            FOREIGN KEY (approved_by) REFERENCES users(id) ON DELETE SET NULL,
            FOREIGN KEY (rejected_by) REFERENCES users(id) ON DELETE SET NULL
          );

          INSERT INTO payment_orders_v2 (
            id, organization_id, member_id, payment_type, bishi_record_id, loan_id,
            amount, currency, bank, provider, provider_order_id, provider_payment_id,
            status, idempotency_key, financial_transaction_id, approved_by, approved_at,
            rejected_by, rejected_at, rejection_reason, notes, expires_at, completed_at,
            created_at, updated_at
          )
          SELECT 
            id, organization_id, member_id, 
            COALESCE(payment_type, 'BISHI'), 
            bishi_record_id, 
            loan_id,
            amount, currency, bank, provider, provider_order_id, provider_payment_id,
            status, idempotency_key, financial_transaction_id, approved_by, approved_at,
            rejected_by, rejected_at, rejection_reason, notes, expires_at, completed_at,
            created_at, updated_at
          FROM payment_orders;

          DROP TABLE payment_orders;
          ALTER TABLE payment_orders_v2 RENAME TO payment_orders;
          CREATE INDEX IF NOT EXISTS idx_payment_orders_org ON payment_orders(organization_id);
          CREATE INDEX IF NOT EXISTS idx_payment_orders_member ON payment_orders(member_id);
          CREATE INDEX IF NOT EXISTS idx_payment_orders_bishi ON payment_orders(bishi_record_id);
          CREATE INDEX IF NOT EXISTS idx_payment_orders_loan ON payment_orders(loan_id);
          CREATE INDEX IF NOT EXISTS idx_payment_orders_status ON payment_orders(status);
          CREATE INDEX IF NOT EXISTS idx_payment_orders_idempotency ON payment_orders(idempotency_key);
        `);
        db.exec('PRAGMA foreign_keys = ON;');
        console.log('✅ payment_orders table migrated with nullable bishi_record_id.');
      }
    }
  } catch (err) {
    console.error('Migration warning for payment_orders Phase 19:', err);
  }

  console.log('✅ Migrations applied successfully.');
}

// Allow direct execution from CLI
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    runMigrations();
    closeDatabase();
    process.exit(0);
  } catch (error) {
    console.error('❌ Migration failed:', error);
    closeDatabase();
    process.exit(1);
  }
}
