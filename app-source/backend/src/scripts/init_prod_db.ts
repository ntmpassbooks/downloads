import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

process.env.NODE_ENV = 'production';
process.env.DB_PATH = './data/ntm_prod.sqlite';
process.env.SESSION_SECRET = process.env.SESSION_SECRET || 'prod-init-secret-placeholder-minimum-32-chars!';

import { runMigrations } from '../db/migrate.js';
import { getDatabase, closeDatabase } from '../db/connection.js';

export function initializeProductionDatabase(): void {
  console.log('==================================================');
  console.log('🚀 INITIALIZING EMPTY PRODUCTION DATABASE');
  console.log('==================================================');

  const resolvedDbPath = path.resolve(process.cwd(), './data/ntm_prod.sqlite');
  console.log(`📁 Target Production DB: ${resolvedDbPath}`);

  // 1. Run migrations to create clean tables and indices
  runMigrations();

  // 2. Verify clean empty state (0 users, 0 transactions, 0 expenses)
  const db = getDatabase();

  const tables = ['users', 'organizations', 'sessions', 'bishi_configs', 'bishi_records', 'financial_transactions', 'loans', 'loan_repayments', 'expenses', 'audit_logs'];

  console.log('\n📊 Production Table Verification:');
  for (const table of tables) {
    const row = db.prepare(`SELECT COUNT(*) as count FROM ${table}`).get() as { count: number };
    console.log(`   - ${table.padEnd(25)}: ${row.count} rows`);
    if (row.count !== 0 && table !== 'audit_logs') {
      throw new Error(`CRITICAL: Table ${table} is not empty! Contains ${row.count} rows.`);
    }
  }

  console.log('\n✅ Production database successfully initialized with zero fake/demo rows.');
  console.log('🔒 Public registration is OPEN for exactly ONE First President.');
  console.log('==================================================\n');

  closeDatabase();
}

if (process.argv[1] && (process.argv[1].endsWith('init_prod_db.ts') || process.argv[1].endsWith('init_prod_db.js'))) {
  try {
    initializeProductionDatabase();
    process.exit(0);
  } catch (err) {
    console.error('❌ Failed to initialize production database:', err);
    closeDatabase();
    process.exit(1);
  }
}
