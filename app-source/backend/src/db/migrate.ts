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

    if (pcfgTable && (!pcfgTable.sql.includes('bank TEXT') || pcfgTable.sql.includes('RAZORPAY'))) {
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
