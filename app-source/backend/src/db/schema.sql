-- Organizations (मंडळ)
CREATE TABLE IF NOT EXISTS organizations (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  code TEXT UNIQUE NOT NULL,
  registration_number TEXT,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Users (सदस्य, खजिनदार, अध्यक्ष)
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  phone TEXT NOT NULL,
  full_name TEXT NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('PRESIDENT', 'TREASURER', 'MEMBER')),
  pin_hash TEXT NOT NULL,
  pin_salt TEXT NOT NULL,
  encrypted_pin TEXT,
  pin_iv TEXT,
  pin_auth_tag TEXT,
  pin_key_version INTEGER DEFAULT 1,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE,
  UNIQUE (organization_id, phone)
);

-- Sessions (सत्र व्यवस्थापन)
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at DATETIME NOT NULL,
  ip_address TEXT,
  user_agent TEXT,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Audit Logs (सुरक्षा व व्यवहार नोंदी)
CREATE TABLE IF NOT EXISTS audit_logs (
  id TEXT PRIMARY KEY,
  organization_id TEXT,
  user_id TEXT,
  action TEXT NOT NULL,
  details TEXT,
  ip_address TEXT,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE SET NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
);

-- Indices for rapid lookup & tenant isolation
CREATE INDEX IF NOT EXISTS idx_users_org ON users(organization_id);
CREATE INDEX IF NOT EXISTS idx_users_phone ON users(phone);
CREATE INDEX IF NOT EXISTS idx_sessions_token ON sessions(token_hash);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_org ON audit_logs(organization_id);

-- Bishi Configurations (सभासद बीसी रचना - अध्यक्ष नियंत्रण)
CREATE TABLE IF NOT EXISTS bishi_configs (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  member_id TEXT NOT NULL,
  monthly_amount INTEGER NOT NULL CHECK (monthly_amount > 0),
  due_day INTEGER NOT NULL CHECK (due_day >= 1 AND due_day <= 31),
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE,
  FOREIGN KEY (member_id) REFERENCES users(id) ON DELETE CASCADE,
  UNIQUE (organization_id, member_id)
);

-- Bishi Monthly Records (अपरिवर्तनीय मासिक नोंदी - Historical Snapshots)
CREATE TABLE IF NOT EXISTS bishi_records (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  member_id TEXT NOT NULL,
  bishi_config_id TEXT NOT NULL,
  month_year TEXT NOT NULL,
  expected_amount INTEGER NOT NULL CHECK (expected_amount > 0),
  due_date TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('PENDING', 'PAID', 'OVERDUE')) DEFAULT 'PENDING',
  paid_amount INTEGER NOT NULL DEFAULT 0 CHECK (paid_amount >= 0),
  paid_date DATETIME,
  payment_method TEXT,
  notes TEXT,
  payment_transaction_id TEXT,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE,
  FOREIGN KEY (member_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (bishi_config_id) REFERENCES bishi_configs(id) ON DELETE RESTRICT,
  UNIQUE (organization_id, member_id, month_year)
);

-- Bishi Indices for rapid lookup, tenant isolation & duplicate cycle protection
CREATE INDEX IF NOT EXISTS idx_bishi_configs_org ON bishi_configs(organization_id);
CREATE INDEX IF NOT EXISTS idx_bishi_configs_member ON bishi_configs(member_id);
CREATE INDEX IF NOT EXISTS idx_bishi_records_org_month ON bishi_records(organization_id, month_year);
CREATE INDEX IF NOT EXISTS idx_bishi_records_member ON bishi_records(member_id);
CREATE INDEX IF NOT EXISTS idx_bishi_records_status ON bishi_records(status);

-- Financial Ledger Transactions (अधिकृत आर्थिक लेजर नोंदी)
CREATE TABLE IF NOT EXISTS financial_transactions (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  member_id TEXT, -- Nullable for organization-level transactions like EXPENSE
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

-- Financial Ledger Indices for rapid lookup, deterministic ordering & tenant isolation
CREATE INDEX IF NOT EXISTS idx_fin_txns_org ON financial_transactions(organization_id);
CREATE INDEX IF NOT EXISTS idx_fin_txns_member ON financial_transactions(member_id);
CREATE INDEX IF NOT EXISTS idx_fin_txns_ref ON financial_transactions(reference_id);
CREATE INDEX IF NOT EXISTS idx_fin_txns_date ON financial_transactions(transaction_date DESC, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_fin_txns_number ON financial_transactions(transaction_number);

-- Loans / Udhar (सभासद कर्ज व उधार नोंदणी - अध्यक्ष नियंत्रण)
CREATE TABLE IF NOT EXISTS loans (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  member_id TEXT NOT NULL,
  actor_id TEXT NOT NULL, -- President or Treasurer who authorized the loan
  amount INTEGER NOT NULL CHECK (amount > 0), -- Principal loan amount
  loan_date DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  status TEXT NOT NULL CHECK(status IN ('ACTIVE', 'CLOSED', 'CANCELLED')) DEFAULT 'ACTIVE',
  interest_rate REAL NOT NULL DEFAULT 0.0,
  interest_type TEXT NOT NULL CHECK(interest_type IN ('FLAT', 'REDUCING_BALANCE')) DEFAULT 'FLAT',
  rate_period TEXT NOT NULL CHECK(rate_period IN ('MONTHLY', 'ANNUAL')) DEFAULT 'ANNUAL',
  tenure_months INTEGER NOT NULL DEFAULT 1 CHECK(tenure_months >= 1),
  monthly_installment INTEGER NOT NULL DEFAULT 0,
  total_interest INTEGER NOT NULL DEFAULT 0,
  total_payable INTEGER NOT NULL DEFAULT 0,
  first_due_date TEXT,
  notes TEXT,
  disbursement_transaction_id TEXT,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE,
  FOREIGN KEY (member_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (actor_id) REFERENCES users(id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_loans_org ON loans(organization_id);
CREATE INDEX IF NOT EXISTS idx_loans_member ON loans(member_id);
CREATE INDEX IF NOT EXISTS idx_loans_status ON loans(status);

-- Loan Installments (हप्ते वेळापत्रक व हप्ता स्थिती)
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

-- Loan Repayments (कर्ज परतफेड नोंदी - रोख व ऑनलाइन)
CREATE TABLE IF NOT EXISTS loan_repayments (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  loan_id TEXT NOT NULL,
  member_id TEXT NOT NULL,
  actor_id TEXT NOT NULL, -- Officer who collected/approved payment
  amount INTEGER NOT NULL CHECK (amount > 0),
  principal_paid INTEGER NOT NULL DEFAULT 0,
  interest_paid INTEGER NOT NULL DEFAULT 0,
  payment_method TEXT NOT NULL CHECK(payment_method IN ('CASH', 'ONLINE')) DEFAULT 'CASH',
  repayment_date DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  transaction_id TEXT UNIQUE, -- Link to financial_transactions(id)
  notes TEXT,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE,
  FOREIGN KEY (loan_id) REFERENCES loans(id) ON DELETE CASCADE,
  FOREIGN KEY (member_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (actor_id) REFERENCES users(id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_loan_repayments_org ON loan_repayments(organization_id);
CREATE INDEX IF NOT EXISTS idx_loan_repayments_loan ON loan_repayments(loan_id);
CREATE INDEX IF NOT EXISTS idx_loan_repayments_member ON loan_repayments(member_id);

-- Expenses (मंडळ खर्च व्यवस्थापन - अध्यक्ष व खजिनदार नियंत्रण)
CREATE TABLE IF NOT EXISTS expenses (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  actor_id TEXT NOT NULL, -- Officer who recorded the expense (President / Treasurer)
  amount INTEGER NOT NULL CHECK (amount > 0),
  category TEXT NOT NULL CHECK(category IN ('मंडळ कार्यक्रम', 'साहित्य', 'प्रवास', 'कार्यालयीन खर्च', 'देखभाल', 'इतर')),
  expense_date DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  reason TEXT NOT NULL CHECK(length(reason) >= 2 AND length(reason) <= 255),
  status TEXT NOT NULL CHECK(status IN ('CONFIRMED', 'CANCELLED')) DEFAULT 'CONFIRMED',
  transaction_id TEXT UNIQUE, -- Link to financial_transactions(id)
  notes TEXT,
  receipt_url TEXT, -- Extensible for future document uploads
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE,
  FOREIGN KEY (actor_id) REFERENCES users(id) ON DELETE RESTRICT,
  FOREIGN KEY (transaction_id) REFERENCES financial_transactions(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_expenses_org_date ON expenses(organization_id, expense_date DESC);
CREATE INDEX IF NOT EXISTS idx_expenses_org_category ON expenses(organization_id, category);
CREATE INDEX IF NOT EXISTS idx_expenses_txn ON expenses(transaction_id);
CREATE INDEX IF NOT EXISTS idx_expenses_actor ON expenses(actor_id);

-- Payment Configurations (मंडळ ऑनलाइन पेमेंट रचना - अध्यक्ष नियंत्रण: UPI ID व QR Code)
CREATE TABLE IF NOT EXISTS payment_configs (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL UNIQUE,
  upi_id TEXT,
  qr_code_data TEXT,
  is_active INTEGER NOT NULL DEFAULT 0 CHECK(is_active IN (0, 1)),
  notes TEXT,
  bank TEXT,
  provider TEXT,
  account_name TEXT,
  account_type TEXT,
  account_number TEXT,
  ifsc TEXT,
  branch TEXT,
  merchant_id TEXT,
  credentials_encrypted TEXT,
  credentials_iv TEXT,
  credentials_tag TEXT,
  status TEXT DEFAULT 'PENDING',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_payment_configs_org ON payment_configs(organization_id);

-- Payment Orders (ऑनलाइन बिशी भरणा व कर्ज परतफेड नोंदी - अध्यक्ष/खजिनदार प्रत्यक्ष पडताळणी)
CREATE TABLE IF NOT EXISTS payment_orders (
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

CREATE INDEX IF NOT EXISTS idx_payment_orders_org ON payment_orders(organization_id);
CREATE INDEX IF NOT EXISTS idx_payment_orders_member ON payment_orders(member_id);
CREATE INDEX IF NOT EXISTS idx_payment_orders_bishi ON payment_orders(bishi_record_id);
CREATE INDEX IF NOT EXISTS idx_payment_orders_loan ON payment_orders(loan_id);

-- Notifications (सूचना व्यवस्थापन - बहु-भाडेकरू व भूमिका-आधारित)
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

-- Device Tokens (पुश नोटिफिकेशन्स - Android, iOS, Web)
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

