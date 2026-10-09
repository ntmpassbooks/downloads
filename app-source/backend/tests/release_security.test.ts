process.env.NODE_ENV = 'test';
process.env.DB_PATH = './data/ntm_test.sqlite';

import test, { before, after, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { Server } from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import sqlite3 from 'node:sqlite';
import { createApp } from '../src/app.js';
import { seedDatabase } from '../src/db/seed.js';
import { closeDatabase } from '../src/db/connection.js';
import { ReleaseService } from '../src/modules/release/release.service.js';
import { createStagingApkArtifact } from '../src/scripts/generate_staging_encrypted_release.js';

let server: Server;
let baseUrl: string;

before(async () => {
  seedDatabase();

  const app = createApp();
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => {
      const addr = server.address();
      if (typeof addr === 'object' && addr !== null) {
        baseUrl = `http://127.0.0.1:${addr.port}`;
      }
      resolve();
    });
  });
});

after(async () => {
  await new Promise<void>((resolve) => {
    server.close(() => resolve());
  });
  closeDatabase();
});

beforeEach(() => {
  ReleaseService.resetStore();
});

async function apiPost(endpoint: string, body: Record<string, any>, clientIp?: string) {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (clientIp) {
    headers['X-Forwarded-For'] = clientIp;
  }
  const res = await fetch(`${baseUrl}${endpoint}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}

describe('NTM Passbook — Batch 13.6: Real Encrypted Release Pipeline & Key Exchange Suite', () => {
  // ==========================================================================
  // 1. Download Token Issuance
  // ==========================================================================
  test('1. POST /api/release/download-token issues valid 64-char hex token and TTL', async () => {
    const res = await apiPost('/api/release/download-token', { releaseVersion: '2.0.0' });

    assert.equal(res.status, 200);
    assert.equal(res.data.success, true);
    assert.equal(typeof res.data.downloadToken, 'string');
    assert.equal(res.data.downloadToken.length, 64); // 32 bytes hex
    assert.equal(res.data.expiresInSeconds, 60);
    assert.equal(res.data.releaseVersion, '2.0.0');
  });

  // ==========================================================================
  // 2. Token Input Validation
  // ==========================================================================
  test('2. POST /api/release/download-token validates releaseVersion format and rejects invalid inputs', async () => {
    // Missing releaseVersion
    const res1 = await apiPost('/api/release/download-token', {});
    assert.equal(res1.status, 400);
    assert.equal(res1.data.success, false);

    // Empty releaseVersion
    const res2 = await apiPost('/api/release/download-token', { releaseVersion: '' });
    assert.equal(res2.status, 400);

    // Malformed releaseVersion with unsafe characters
    const res3 = await apiPost('/api/release/download-token', { releaseVersion: '2.0.0<script>' });
    assert.equal(res3.status, 400);
  });

  // ==========================================================================
  // 3. Rate Limiting Protection
  // ==========================================================================
  test('3. POST /api/release/download-token enforces IP rate limiting (429 Too Many Requests)', async () => {
    const ip = '192.168.1.105';
    ReleaseService.setRateLimitMax(3); // Set threshold to 3 for testing

    // First 3 should succeed
    for (let i = 0; i < 3; i++) {
      const res = await apiPost('/api/release/download-token', { releaseVersion: '2.0.0' }, ip);
      assert.equal(res.status, 200);
      assert.equal(res.data.success, true);
    }

    // 4th request must be rejected with 429
    const res4 = await apiPost('/api/release/download-token', { releaseVersion: '2.0.0' }, ip);
    assert.equal(res4.status, 429);
    assert.equal(res4.data.success, false);
    assert.match(res4.data.error, /जास्त/);
  });

  // ==========================================================================
  // 4. Successful Key Exchange
  // ==========================================================================
  test('4. POST /api/release/key delivers ephemeral 256-bit AES-GCM release key with valid token', async () => {
    const tokenRes = await apiPost('/api/release/download-token', { releaseVersion: '2.0.0' });
    const token = tokenRes.data.downloadToken;

    const keyRes = await apiPost('/api/release/key', {
      downloadToken: token,
      releaseVersion: '2.0.0',
    });

    assert.equal(keyRes.status, 200);
    assert.equal(keyRes.data.success, true);
    assert.equal(keyRes.data.algorithm, 'AES-256-GCM');
    assert.equal(keyRes.data.keyId, 'k_2.0.0');
    assert.equal(typeof keyRes.data.releaseKey, 'string');
    assert.equal(keyRes.data.releaseKey.length, 64); // 32-byte (256-bit) hex key
    assert.equal(keyRes.data.expiresInSeconds, 60);
  });

  // ==========================================================================
  // 5. Single-Use Replay Protection
  // ==========================================================================
  test('5. Replay Protection: Consuming token a second time is strictly rejected with 403', async () => {
    const tokenRes = await apiPost('/api/release/download-token', { releaseVersion: '2.0.0' });
    const token = tokenRes.data.downloadToken;

    // First exchange succeeds
    const keyRes1 = await apiPost('/api/release/key', {
      downloadToken: token,
      releaseVersion: '2.0.0',
    });
    assert.equal(keyRes1.status, 200);

    // Second exchange with identical token MUST fail with 403
    const keyRes2 = await apiPost('/api/release/key', {
      downloadToken: token,
      releaseVersion: '2.0.0',
    });
    assert.equal(keyRes2.status, 403);
    assert.equal(keyRes2.data.success, false);
    assert.match(keyRes2.data.error, /आधीच वापरला/);
  });

  // ==========================================================================
  // 6. Token Expiry Check
  // ==========================================================================
  test('6. Expired Token: Token past TTL expiration is rejected with 401', async () => {
    // Manually register an expired token (expired 10 seconds ago, within retention window)
    const expiredToken = crypto.randomBytes(32).toString('hex');
    (ReleaseService as any).tokenStore.set(expiredToken, {
      releaseVersion: '2.0.0',
      clientIp: '127.0.0.1',
      createdAt: Date.now() - 70_000,
      expiresAt: Date.now() - 10_000, // Expired 10 seconds ago
      used: false,
    });

    const res = await apiPost('/api/release/key', {
      downloadToken: expiredToken,
      releaseVersion: '2.0.0',
    });

    assert.equal(res.status, 401);
    assert.equal(res.data.success, false);
    assert.match(res.data.error, /मुदत संपली|expired/i);
  });

  // ==========================================================================
  // 7. Non-Existent or Tampered Token
  // ==========================================================================
  test('7. Tampered or non-existent token is rejected with 401', async () => {
    const fakeToken = crypto.randomBytes(32).toString('hex');
    const res = await apiPost('/api/release/key', {
      downloadToken: fakeToken,
      releaseVersion: '2.0.0',
    });

    assert.equal(res.status, 401);
    assert.equal(res.data.success, false);
    assert.match(res.data.error, /अवैध/);
  });

  // ==========================================================================
  // 8. Version Mismatch Rejection
  // ==========================================================================
  test('8. Version mismatch between token request and key request is rejected with 400', async () => {
    const tokenRes = await apiPost('/api/release/download-token', { releaseVersion: '2.0.0' });
    const token = tokenRes.data.downloadToken;

    // Request key for 1.0.0 using 2.0.0 token
    const keyRes = await apiPost('/api/release/key', {
      downloadToken: token,
      releaseVersion: '1.0.0',
    });

    assert.equal(keyRes.status, 400);
    assert.equal(keyRes.data.success, false);
    assert.match(keyRes.data.error, /जुळत नाही/);
  });

  // ==========================================================================
  // 9. Missing Token Validation
  // ==========================================================================
  test('9. Missing token in request body is rejected with 400', async () => {
    const res = await apiPost('/api/release/key', { releaseVersion: '2.0.0' });
    assert.equal(res.status, 400);
    assert.equal(res.data.success, false);
  });

  // ==========================================================================
  // 10. Key Confidentiality & Master Key Secrecy
  // ==========================================================================
  test('10. Master release key is never exposed; derived keys differ from master key and are deterministic per version', () => {
    const key1 = ReleaseService.deriveReleaseKeyHex('2.0.0');
    const key2 = ReleaseService.deriveReleaseKeyHex('2.0.0');

    // Deterministic for same version
    assert.equal(key1, key2);

    // Never equals master key
    const masterKey = process.env.RELEASE_MASTER_KEY || 'dev_release_master_encryption_key_32_chars!';
    assert.notEqual(key1, masterKey);
    assert.equal(key1.length, 64);
  });

  // ==========================================================================
  // 11. Key Isolation Across Versions
  // ==========================================================================
  test('11. Release key for version 2.0.0 differs cryptographically from version 1.0.0 and staging', () => {
    const keyV1 = ReleaseService.deriveReleaseKeyHex('1.0.0');
    const keyV2 = ReleaseService.deriveReleaseKeyHex('2.0.0');
    const keyStaging = ReleaseService.deriveReleaseKeyHex('2.0.0-staging');

    assert.notEqual(keyV1, keyV2);
    assert.notEqual(keyV2, keyStaging);
    assert.notEqual(keyV1, keyStaging);
  });

  // ==========================================================================
  // 12. AEAD Package Structure
  // ==========================================================================
  test('12. Release artifact encryption produces standard AES-256-GCM package format: IV (12B) || Ciphertext || Tag (16B)', () => {
    const plaintext = Buffer.from('TEST_APK_BINARY_PAYLOAD_NTM');
    const pkg = ReleaseService.encryptReleaseArtifact(plaintext, '2.0.0');

    // Package size = 12 (IV) + plaintext.length + 16 (Tag)
    const expectedSize = 12 + plaintext.length + 16;
    assert.equal(pkg.packageSize, expectedSize);
    assert.equal(pkg.encryptedBuffer.length, expectedSize);
    assert.equal(pkg.iv.length, 24); // 12 bytes hex
    assert.equal(pkg.authTag.length, 32); // 16 bytes hex

    // Verify IV at start
    const extractedIv = pkg.encryptedBuffer.subarray(0, 12).toString('hex');
    assert.equal(extractedIv, pkg.iv);

    // Verify AuthTag at end
    const extractedTag = pkg.encryptedBuffer.subarray(pkg.encryptedBuffer.length - 16).toString('hex');
    assert.equal(extractedTag, pkg.authTag);
  });

  // ==========================================================================
  // 13. Decryption Roundtrip
  // ==========================================================================
  test('13. Decryption round-trip recovers byte-for-byte exact original artifact', () => {
    const original = createStagingApkArtifact();
    const pkg = ReleaseService.encryptReleaseArtifact(original, '2.0.0');

    const decrypted = ReleaseService.decryptReleaseArtifact(pkg.encryptedBuffer, '2.0.0');

    assert.equal(decrypted.length, original.length);
    assert.ok(decrypted.equals(original));
  });

  // ==========================================================================
  // 14. Ciphertext Tamper Defense
  // ==========================================================================
  test('14. Decryption fails when ciphertext is tampered (AEAD authentication tag verification)', () => {
    const original = Buffer.from('AUTHENTIC_PAYLOAD_BYTES_NTM_FINANCE');
    const pkg = ReleaseService.encryptReleaseArtifact(original, '2.0.0');

    // Corrupt one byte in the ciphertext region (between byte 12 and byte length - 16)
    const tampered = Buffer.from(pkg.encryptedBuffer);
    tampered[15] = tampered[15] ^ 0xff;

    assert.throws(
      () => ReleaseService.decryptReleaseArtifact(tampered, '2.0.0'),
      /Unsupported state or unable to authenticate data|bad decrypt/i
    );
  });

  // ==========================================================================
  // 15. IV Tamper Defense
  // ==========================================================================
  test('15. Decryption fails when IV is tampered or corrupted', () => {
    const original = Buffer.from('AUTHENTIC_PAYLOAD_BYTES_NTM_FINANCE');
    const pkg = ReleaseService.encryptReleaseArtifact(original, '2.0.0');

    // Corrupt one byte in IV region (byte 0..11)
    const tampered = Buffer.from(pkg.encryptedBuffer);
    tampered[2] = tampered[2] ^ 0x01;

    assert.throws(
      () => ReleaseService.decryptReleaseArtifact(tampered, '2.0.0'),
      /Unsupported state or unable to authenticate data|bad decrypt/i
    );
  });

  // ==========================================================================
  // 16. Wrong Release Key Defense
  // ==========================================================================
  test('16. Decryption fails when wrong release version / key is used', () => {
    const original = Buffer.from('AUTHENTIC_PAYLOAD_BYTES_NTM_FINANCE');
    const pkg = ReleaseService.encryptReleaseArtifact(original, '2.0.0');

    // Attempt decryption with wrong version (1.0.0)
    assert.throws(
      () => ReleaseService.decryptReleaseArtifact(pkg.encryptedBuffer, '1.0.0'),
      /Unsupported state or unable to authenticate data|bad decrypt/i
    );
  });

  // ==========================================================================
  // 17. Web Crypto Client Interoperability
  // ==========================================================================
  test('17. Web Crypto Client Interoperability: SubtleCrypto.decrypt decrypts AEAD package cleanly', async () => {
    const original = createStagingApkArtifact();
    const pkg = ReleaseService.encryptReleaseArtifact(original, '2.0.0-staging');
    const releaseKeyHex = ReleaseService.deriveReleaseKeyHex('2.0.0-staging');

    // Simulate browser Web Crypto API
    const rawKey = Buffer.from(releaseKeyHex, 'hex');
    const cryptoKey = await crypto.webcrypto.subtle.importKey(
      'raw',
      rawKey,
      { name: 'AES-GCM' },
      false,
      ['decrypt']
    );

    const iv = pkg.encryptedBuffer.subarray(0, 12);
    const ciphertextAndTag = pkg.encryptedBuffer.subarray(12);

    const decryptedArrayBuf = await crypto.webcrypto.subtle.decrypt(
      { name: 'AES-GCM', iv },
      cryptoKey,
      ciphertextAndTag
    );

    const clientDecrypted = Buffer.from(decryptedArrayBuf);
    assert.ok(clientDecrypted.equals(original));
  });

  // ==========================================================================
  // 18. Post-Decryption Hash & ZIP Header Verification
  // ==========================================================================
  test('18. Decrypted payload validates SHA-256 checksum and ZIP header magic bytes (PK\\x03\\x04)', async () => {
    const original = createStagingApkArtifact();
    const expectedSha256 = crypto.createHash('sha256').update(original).digest('hex').toUpperCase();

    const pkg = ReleaseService.encryptReleaseArtifact(original, '2.0.0-staging');
    const decrypted = ReleaseService.decryptReleaseArtifact(pkg.encryptedBuffer, '2.0.0-staging');

    // 1. Verify SHA-256 via Web Crypto
    const hashBuf = await crypto.webcrypto.subtle.digest('SHA-256', decrypted);
    const computedSha256 = Buffer.from(hashBuf).toString('hex').toUpperCase();
    assert.equal(computedSha256, expectedSha256);

    // 2. Verify ZIP magic bytes PK\x03\x04
    assert.equal(decrypted[0], 0x50);
    assert.equal(decrypted[1], 0x4b);
    assert.equal(decrypted[2], 0x03);
    assert.equal(decrypted[3], 0x04);
  });

  // ==========================================================================
  // 19. Staging Encrypted Package Integrity
  // ==========================================================================
  test('19. Staging encrypted release package exists and manifest specifies valid endpoints', () => {
    const encPath = path.resolve(process.cwd(), '../downloads/staging-test-release-v2.0.0.apk.enc');
    const manifestPath = path.resolve(process.cwd(), '../downloads/staging-release-manifest.json');

    assert.ok(fs.existsSync(encPath), 'staging-test-release-v2.0.0.apk.enc must exist');
    assert.ok(fs.existsSync(manifestPath), 'staging-release-manifest.json must exist');

    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    assert.equal(manifest.version, '2.0.0-staging');
    assert.equal(manifest.algorithm, 'AES-256-GCM');
    assert.equal(manifest.keyExchangeEndpoint, '/api/release/key');
    assert.equal(manifest.tokenEndpoint, '/api/release/download-token');

    const encBytes = fs.readFileSync(encPath);
    assert.equal(encBytes.length, manifest.encryptedPackageSize);
  });

  // ==========================================================================
  // 20. Production Preservation & Financial DB Isolation
  // ==========================================================================
  test('20. Production APK remains untouched (exact hash & size) and production financial tables have 0 rows', () => {
    // 1. Verify production release APK untouched
    const prodApkPath = path.resolve(process.cwd(), '../downloads/NTM-Passbook-Android-v1.0.0.apk');
    assert.ok(fs.existsSync(prodApkPath), 'Production V1.0.0 APK must exist');

    const prodApkBytes = fs.readFileSync(prodApkPath);
    assert.equal(prodApkBytes.length, 11615753, 'Production V1.0.0 APK size must be exactly 11,615,753 bytes');

    const hash = crypto.createHash('sha256').update(prodApkBytes).digest('hex').toUpperCase();
    assert.equal(
      hash,
      'BE038471CD7CBBF47407DD0D9249D06DFA4BE8D26E70EFDBF1827F74B110449C',
      'Production V1.0.0 APK hash must remain strictly BE038471...449C'
    );

    // 2. Verify production SQLite database financial tables remain 0 rows
    const prodDbPath = path.resolve(process.cwd(), 'data/ntm_prod.sqlite');
    assert.ok(fs.existsSync(prodDbPath), 'Production database must exist');

    const db = new sqlite3.DatabaseSync(prodDbPath);
    const financialTables = [
      'bishi_configs',
      'bishi_records',
      'expenses',
      'financial_transactions',
      'loan_repayments',
      'loans',
      'payment_orders',
    ];

    for (const table of financialTables) {
      const row = db.prepare(`SELECT COUNT(*) as count FROM ${table}`).get() as { count: number };
      assert.equal(row.count, 0, `Table ${table} in ntm_prod.sqlite must have exactly 0 rows`);
    }
    db.close();
  });
});
