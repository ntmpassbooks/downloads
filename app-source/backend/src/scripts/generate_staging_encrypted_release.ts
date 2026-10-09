import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { ReleaseService } from '../modules/release/release.service.js';

/**
 * Computes standard CRC-32 for ZIP archive entries.
 */
function crc32(buffer: Buffer): number {
  let crc = 0 ^ -1;
  for (let i = 0; i < buffer.length; i++) {
    crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ buffer[i]) & 0xff];
  }
  return (crc ^ -1) >>> 0;
}

const CRC_TABLE = new Int32Array(256);
for (let i = 0; i < 256; i++) {
  let c = i;
  for (let k = 0; k < 8; k++) {
    c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  CRC_TABLE[i] = c;
}

/**
 * Creates a standard-compliant ZIP / APK test artifact containing AndroidManifest.xml and classes.dex.
 * Guarantees standard magic header: PK\x03\x04 (0x50, 0x4B, 0x03, 0x04).
 */
export function createStagingApkArtifact(): Buffer {
  const files = [
    {
      name: 'AndroidManifest.xml',
      data: Buffer.from(
        '<?xml version="1.0" encoding="utf-8"?>\n<manifest xmlns:android="http://schemas.android.com/apk/res/android" package="com.ntmpassbook.app" android:versionCode="200" android:versionName="2.0.0-staging">\n  <application android:label="NTM Passbook Staging"/>\n</manifest>',
        'utf8'
      ),
    },
    {
      name: 'classes.dex',
      data: Buffer.from('dex\n035\0NTM_PASSBOOK_STAGING_TEST_BYTECODE_2026', 'utf8'),
    },
  ];

  const localHeaders: Buffer[] = [];
  const cdHeaders: Buffer[] = [];
  let offset = 0;

  for (const file of files) {
    const fileCrc = crc32(file.data);
    const nameBuf = Buffer.from(file.name, 'utf8');

    // Local file header (30 bytes + name)
    const localHeader = Buffer.alloc(30 + nameBuf.length);
    localHeader.writeUInt32LE(0x04034b50, 0); // PK\x03\x04
    localHeader.writeUInt16LE(20, 4);        // Version needed
    localHeader.writeUInt16LE(0, 6);         // Flags
    localHeader.writeUInt16LE(0, 8);         // Store (no compression)
    localHeader.writeUInt16LE(0x4000, 10);   // Time
    localHeader.writeUInt16LE(0x5c21, 12);   // Date
    localHeader.writeUInt32LE(fileCrc, 14);  // CRC-32
    localHeader.writeUInt32LE(file.data.length, 18); // Comp size
    localHeader.writeUInt32LE(file.data.length, 22); // Uncomp size
    localHeader.writeUInt16LE(nameBuf.length, 26);   // Name len
    localHeader.writeUInt16LE(0, 28);               // Extra len
    nameBuf.copy(localHeader, 30);

    localHeaders.push(localHeader, file.data);

    // Central directory header (46 bytes + name)
    const cdHeader = Buffer.alloc(46 + nameBuf.length);
    cdHeader.writeUInt32LE(0x02014b50, 0); // PK\x01\x02
    cdHeader.writeUInt16LE(20, 4);         // Version made by
    cdHeader.writeUInt16LE(20, 6);         // Version needed
    cdHeader.writeUInt16LE(0, 8);          // Flags
    cdHeader.writeUInt16LE(0, 10);         // Compression: none
    cdHeader.writeUInt16LE(0x4000, 12);    // Time
    cdHeader.writeUInt16LE(0x5c21, 14);    // Date
    cdHeader.writeUInt32LE(fileCrc, 16);   // CRC-32
    cdHeader.writeUInt32LE(file.data.length, 20); // Comp size
    cdHeader.writeUInt32LE(file.data.length, 24); // Uncomp size
    cdHeader.writeUInt16LE(nameBuf.length, 28);   // Name len
    cdHeader.writeUInt16LE(0, 30);                // Extra len
    cdHeader.writeUInt16LE(0, 32);                // Comment len
    cdHeader.writeUInt16LE(0, 34);                // Disk start
    cdHeader.writeUInt16LE(0, 36);                // Internal attr
    cdHeader.writeUInt32LE(0, 38);                // External attr
    cdHeader.writeUInt32LE(offset, 42);           // Relative offset of local header
    nameBuf.copy(cdHeader, 46);

    cdHeaders.push(cdHeader);
    offset += localHeader.length + file.data.length;
  }

  const cdTotalSize = cdHeaders.reduce((sum, b) => sum + b.length, 0);

  // End of central directory record (22 bytes)
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);       // PK\x05\x06
  eocd.writeUInt16LE(0, 4);                // Disk num
  eocd.writeUInt16LE(0, 6);                // Start disk
  eocd.writeUInt16LE(files.length, 8);     // Entries on this disk
  eocd.writeUInt16LE(files.length, 10);    // Total entries
  eocd.writeUInt32LE(cdTotalSize, 12);     // Size of central dir
  eocd.writeUInt32LE(offset, 16);          // Offset of central dir
  eocd.writeUInt16LE(0, 20);               // Comment len

  return Buffer.concat([...localHeaders, ...cdHeaders, eocd]);
}

/**
 * Main script generator for the staging encrypted release pipeline.
 */
export function generateStagingEncryptedRelease(): void {
  const downloadsDir = path.resolve(process.cwd(), '../downloads');
  const prodApkPath = path.join(downloadsDir, 'NTM-Passbook-Android-v1.0.0.apk');

  // SAFEGUARD 1: Confirm production V1.0.0 APK exists and read baseline hash
  if (!fs.existsSync(prodApkPath)) {
    throw new Error(`Production V1.0.0 APK not found at ${prodApkPath}`);
  }
  const prodApkBytes = fs.readFileSync(prodApkPath);
  const prodApkHash = crypto.createHash('sha256').update(prodApkBytes).digest('hex').toUpperCase();
  const EXPECTED_PROD_HASH = 'BE038471CD7CBBF47407DD0D9249D06DFA4BE8D26E70EFDBF1827F74B110449C';
  if (prodApkHash !== EXPECTED_PROD_HASH) {
    throw new Error(`CRITICAL: Production V1.0.0 APK hash mismatch! Found ${prodApkHash}`);
  }

  // Generate independent staging test artifact
  const stagingPlaintext = createStagingApkArtifact();

  // Verify it starts with standard PK\x03\x04
  if (
    stagingPlaintext[0] !== 0x50 ||
    stagingPlaintext[1] !== 0x4b ||
    stagingPlaintext[2] !== 0x03 ||
    stagingPlaintext[3] !== 0x04
  ) {
    throw new Error('Staging test artifact does not have valid ZIP magic bytes');
  }

  const STAGING_VERSION = '2.0.0-staging';
  const encryptedPkg = ReleaseService.encryptReleaseArtifact(stagingPlaintext, STAGING_VERSION);

  // Verify roundtrip decryption immediately
  const decrypted = ReleaseService.decryptReleaseArtifact(encryptedPkg.encryptedBuffer, STAGING_VERSION);
  if (!decrypted.equals(stagingPlaintext)) {
    throw new Error('Cryptographic verification failed: roundtrip decrypted buffer does not match original plaintext');
  }

  const encTargetPath = path.join(downloadsDir, 'staging-test-release-v2.0.0.apk.enc');
  fs.writeFileSync(encTargetPath, encryptedPkg.encryptedBuffer);

  const manifestTargetPath = path.join(downloadsDir, 'staging-release-manifest.json');
  const manifestData = {
    version: STAGING_VERSION,
    status: 'staging-test-only',
    encryptedPackageFile: 'staging-test-release-v2.0.0.apk.enc',
    encryptedPackageSize: encryptedPkg.packageSize,
    plaintextSha256: encryptedPkg.sha256,
    plaintextSizeBytes: stagingPlaintext.length,
    algorithm: 'AES-256-GCM',
    aeadStructure: 'IV [12B] || Ciphertext [NB] || Tag [16B]',
    ivLengthBytes: 12,
    tagLengthBytes: 16,
    keyExchangeEndpoint: '/api/release/key',
    tokenEndpoint: '/api/release/download-token',
    generatedAt: new Date().toISOString(),
  };
  fs.writeFileSync(manifestTargetPath, JSON.stringify(manifestData, null, 2));

  // SAFEGUARD 2: Re-verify production V1.0.0 APK was untouched
  const finalProdApkBytes = fs.readFileSync(prodApkPath);
  const finalProdApkHash = crypto.createHash('sha256').update(finalProdApkBytes).digest('hex').toUpperCase();
  if (finalProdApkHash !== EXPECTED_PROD_HASH || finalProdApkBytes.length !== 11615753) {
    throw new Error('CRITICAL INTEGRITY VIOLATION: Production V1.0.0 APK was modified!');
  }

  console.log('✅ Staging encrypted release generated successfully:');
  console.log(`   Encrypted Package: ${encTargetPath} (${encryptedPkg.packageSize} bytes)`);
  console.log(`   Plaintext SHA-256: ${encryptedPkg.sha256}`);
  console.log(`   Plaintext Size:    ${stagingPlaintext.length} bytes`);
  console.log(`   Production V1.0.0 APK Verified Untouched: ${finalProdApkHash}`);
}

// Execute when run directly via tsx
if (process.argv[1]?.endsWith('generate_staging_encrypted_release.ts')) {
  generateStagingEncryptedRelease();
}
