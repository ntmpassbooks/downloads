import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { getDatabase } from '../db/connection.js';
import { env } from '../config/env.js';

export interface BackupResult {
  success: boolean;
  backupPath: string;
  sourcePath: string;
  sizeBytes: number;
  timestamp: string;
  prunedCount?: number;
}

/**
 * Prunes backup snapshots older than the specified retention window (default 30 days).
 */
export function pruneOldBackups(backupDir: string, retentionDays = 30): number {
  if (!fs.existsSync(backupDir)) return 0;
  const now = Date.now();
  const maxAgeMs = retentionDays * 24 * 60 * 60 * 1000;
  let prunedCount = 0;

  try {
    const files = fs.readdirSync(backupDir);
    for (const file of files) {
      if (file.endsWith('.sqlite') && file.includes('_backup_')) {
        const filePath = path.join(backupDir, file);
        const stats = fs.statSync(filePath);
        if (now - stats.mtimeMs > maxAgeMs) {
          fs.unlinkSync(filePath);
          prunedCount++;
          console.log(`🧹 Pruned old backup older than ${retentionDays} days: ${file}`);
        }
      }
    }
  } catch (err) {
    console.warn('Warning: Pruning old backups encountered error:', err);
  }

  return prunedCount;
}

/**
 * Creates an atomic, online backup of the SQLite database using native VACUUM INTO.
 * Safe to execute while WAL mode transactions are occurring.
 */
export function createDatabaseBackup(customBackupDir?: string, retentionDays = 30): BackupResult {
  const db = getDatabase();
  const sourcePath = path.resolve(process.cwd(), process.env.DB_PATH || env.DB_PATH);
  const baseName = path.basename(sourcePath, path.extname(sourcePath));

  const backupDir = customBackupDir || path.resolve(process.cwd(), './backups');
  if (!fs.existsSync(backupDir)) {
    fs.mkdirSync(backupDir, { recursive: true });
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupFileName = `${baseName}_backup_${timestamp}.sqlite`;
  const backupPath = path.resolve(backupDir, backupFileName);

  console.log(`📦 Starting atomic database backup...`);
  console.log(`   Source: ${sourcePath}`);
  console.log(`   Target: ${backupPath}`);

  // Escape single quotes in path for SQLite
  const escapedBackupPath = backupPath.replace(/'/g, "''");
  db.exec(`VACUUM INTO '${escapedBackupPath}';`);

  if (!fs.existsSync(backupPath)) {
    throw new Error(`Backup file was not created at ${backupPath}`);
  }

  const stats = fs.statSync(backupPath);
  console.log(`✅ Backup successfully created! Size: ${(stats.size / 1024).toFixed(2)} KB`);

  // Apply retention policy: remove snapshots older than 30 days
  const prunedCount = pruneOldBackups(backupDir, retentionDays);
  if (prunedCount > 0) {
    console.log(`🧹 Cleaned up ${prunedCount} expired backup snapshot(s).`);
  }

  return {
    success: true,
    backupPath,
    sourcePath,
    sizeBytes: stats.size,
    timestamp,
    prunedCount,
  };
}

if (process.argv[1] && (process.argv[1].endsWith('backup.ts') || process.argv[1].endsWith('backup.js'))) {
  try {
    createDatabaseBackup();
    process.exit(0);
  } catch (err) {
    console.error('❌ Backup failed:', err);
    process.exit(1);
  }
}
