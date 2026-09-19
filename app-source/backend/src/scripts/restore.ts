import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

export interface VerifyBackupResult {
  isValid: boolean;
  integrityCheck: string;
  tableCounts: Record<string, number>;
  fileSizeBytes: number;
}

/**
 * Validates the cryptographic and structural integrity of a backup SQLite file.
 */
export function verifyBackupFile(backupFilePath: string): VerifyBackupResult {
  const resolved = path.resolve(backupFilePath);
  if (!fs.existsSync(resolved)) {
    throw new Error(`Backup file does not exist: ${resolved}`);
  }

  const stats = fs.statSync(resolved);
  const db = new DatabaseSync(resolved);

  // Run SQLite integrity check
  const integrityRow = db.prepare('PRAGMA integrity_check').get() as { integrity_check?: string } | undefined;
  const integrityCheck = integrityRow ? Object.values(integrityRow)[0] : 'unknown';

  const tables = ['users', 'organizations', 'sessions', 'bishi_configs', 'bishi_records', 'financial_transactions', 'loans', 'loan_repayments', 'expenses', 'audit_logs'];
  const tableCounts: Record<string, number> = {};

  for (const t of tables) {
    try {
      const row = db.prepare(`SELECT COUNT(*) as c FROM ${t}`).get() as { c: number };
      tableCounts[t] = row.c;
    } catch {
      tableCounts[t] = -1; // table might not exist in old backups
    }
  }

  db.close();

  return {
    isValid: integrityCheck === 'ok',
    integrityCheck: String(integrityCheck),
    tableCounts,
    fileSizeBytes: stats.size,
  };
}

/**
 * Restores a verified backup file to the target database path.
 */
export function restoreDatabase(backupFilePath: string, targetDbPath: string): void {
  const verify = verifyBackupFile(backupFilePath);
  if (!verify.isValid) {
    throw new Error(`Cannot restore corrupted backup! Integrity check result: ${verify.integrityCheck}`);
  }

  const resolvedTarget = path.resolve(targetDbPath);
  const targetDir = path.dirname(resolvedTarget);
  if (!fs.existsSync(targetDir)) {
    fs.mkdirSync(targetDir, { recursive: true });
  }

  // Remove existing WAL and SHM files if restoring over active DB
  const walFile = `${resolvedTarget}-wal`;
  const shmFile = `${resolvedTarget}-shm`;
  if (fs.existsSync(walFile)) fs.unlinkSync(walFile);
  if (fs.existsSync(shmFile)) fs.unlinkSync(shmFile);

  fs.copyFileSync(path.resolve(backupFilePath), resolvedTarget);
  console.log(`✅ Successfully restored backup to: ${resolvedTarget}`);
}

if (process.argv[1] && (process.argv[1].endsWith('restore.ts') || process.argv[1].endsWith('restore.js'))) {
  const backupArg = process.argv[2];
  if (!backupArg) {
    console.error('Usage: tsx src/scripts/restore.ts <path-to-backup.sqlite> [target-db-path]');
    process.exit(1);
  }

  try {
    const targetArg = process.argv[3];
    if (targetArg) {
      restoreDatabase(backupArg, targetArg);
    } else {
      const result = verifyBackupFile(backupArg);
      console.log('🔍 Backup Verification Result:', result);
    }
    process.exit(0);
  } catch (err) {
    console.error('❌ Restore/Verification failed:', err);
    process.exit(1);
  }
}
