import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

describe('NTM Passbook — PWA Repair & Secure APK Distribution Audit Suite', () => {
  const downloadsDir = path.resolve('..', 'downloads');
  const manifestPath = path.join(downloadsDir, 'manifest.json');
  const swPath = path.join(downloadsDir, 'sw.js');
  const versionPath = path.join(downloadsDir, 'version.json');
  const htmlPath = path.join(downloadsDir, 'index.html');
  const apkPath = path.join(downloadsDir, 'NTM-Passbook-Android-v1.0.0.apk');
  const assetsDir = path.join(downloadsDir, 'assets');

  // ==========================================================================
  // 1. PWA Manifest Audit
  // ==========================================================================
  test('1. Manifest exists, parses as valid JSON, and has correct /downloads/ scope', () => {
    assert.ok(fs.existsSync(manifestPath), 'manifest.json must exist');
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));

    assert.equal(manifest.name, 'एनटीएम पासबुक (NTM Passbook)');
    assert.equal(manifest.short_name, 'NTM Passbook');
    assert.equal(manifest.scope, '/downloads/', 'PWA scope must strictly be /downloads/');
    assert.equal(manifest.start_url, '/downloads/', 'PWA start_url must be /downloads/');
    assert.equal(manifest.id, '/downloads/', 'PWA id must be /downloads/');
    assert.equal(manifest.display, 'standalone');
    assert.ok(Array.isArray(manifest.display_override) && manifest.display_override.includes('standalone'));
    assert.equal(manifest.background_color, '#050811');
    assert.equal(manifest.theme_color, '#050811');
    assert.equal(manifest.orientation, 'portrait-primary');
    assert.equal(manifest.lang, 'mr');
  });

  test('2. Manifest specifies both "any" and "maskable" icons with valid files on disk', () => {
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
    assert.ok(Array.isArray(manifest.icons) && manifest.icons.length >= 4);

    const has192Any = manifest.icons.some((i: any) => i.sizes === '192x192' && i.purpose === 'any');
    const has512Any = manifest.icons.some((i: any) => i.sizes === '512x512' && i.purpose === 'any');
    const has192Mask = manifest.icons.some((i: any) => i.sizes === '192x192' && i.purpose === 'maskable');
    const has512Mask = manifest.icons.some((i: any) => i.sizes === '512x512' && i.purpose === 'maskable');

    assert.ok(has192Any, 'Manifest must specify 192x192 any icon');
    assert.ok(has512Any, 'Manifest must specify 512x512 any icon');
    assert.ok(has192Mask, 'Manifest must specify 192x192 maskable icon');
    assert.ok(has512Mask, 'Manifest must specify 512x512 maskable icon');

    // Confirm icon files exist on disk
    for (const icon of manifest.icons) {
      const relPath = icon.src.replace(/^\.\//, '');
      const fullPath = path.join(downloadsDir, relPath);
      assert.ok(fs.existsSync(fullPath), `Icon file ${icon.src} must exist at ${fullPath}`);
      const stats = fs.statSync(fullPath);
      assert.ok(stats.size > 1000, `Icon file ${icon.src} must have valid non-empty size`);
    }
  });

  test('3. Dedicated Apple Touch Icon and standard square PWA icons exist with valid PNG signatures', () => {
    const requiredIcons = [
      'icon-192.png',
      'icon-512.png',
      'icon-maskable-192.png',
      'icon-maskable-512.png',
      'apple-touch-icon.png'
    ];

    for (const filename of requiredIcons) {
      const iconPath = path.join(assetsDir, filename);
      assert.ok(fs.existsSync(iconPath), `${filename} must exist in assets/`);
      const buffer = fs.readFileSync(iconPath);
      // PNG magic bytes: 0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A
      assert.equal(buffer[0], 0x89, `${filename} must start with PNG magic byte`);
      assert.equal(buffer[1], 0x50);
      assert.equal(buffer[2], 0x4E);
      assert.equal(buffer[3], 0x47);
    }
  });

  // ==========================================================================
  // 2. Service Worker & Cache Audit
  // ==========================================================================
  test('4. Service Worker version matches version.json and defines proper cache name', () => {
    const swContent = fs.readFileSync(swPath, 'utf-8');
    const versionData = JSON.parse(fs.readFileSync(versionPath, 'utf-8'));

    const expectedCacheName = `ntm-passbook-site-v${versionData.version}`;
    assert.ok(swContent.includes(expectedCacheName), `sw.js must contain cache name ${expectedCacheName}`);
    assert.ok(swContent.includes(`Version: ${versionData.version}`), 'sw.js header must reflect version');
  });

  test('5. Service Worker statically precaches only existing files', () => {
    const swContent = fs.readFileSync(swPath, 'utf-8');
    // Extract STATIC_ASSETS array
    const match = swContent.match(/const STATIC_ASSETS = \[\s*([\s\S]*?)\s*\];/);
    assert.ok(match, 'sw.js must declare STATIC_ASSETS array');

    const assetEntries = match[1]
      .split(',')
      .map((s) => s.trim().replace(/^['"]|['"]$/g, ''))
      .filter((s) => s.length > 0 && s !== './');

    for (const entry of assetEntries) {
      const rel = entry.replace(/^\.\//, '');
      const fullPath = path.join(downloadsDir, rel);
      assert.ok(fs.existsSync(fullPath), `Pre-cached asset ${entry} must exist on disk at ${fullPath}`);
    }
  });

  test('6. Service Worker strictly avoids intercepting financial mutations and API calls', () => {
    const swContent = fs.readFileSync(swPath, 'utf-8');

    // Only GET requests
    assert.ok(swContent.includes("event.request.method !== 'GET'"), 'SW must bypass non-GET requests');
    // Exclude /api/ and /auth/
    assert.ok(swContent.includes("url.pathname.includes('/api/')"), 'SW must never intercept /api/');
    assert.ok(swContent.includes("url.pathname.includes('/auth/')"), 'SW must never intercept /auth/');
    // Exclude .apk and .enc
    assert.ok(swContent.includes("url.pathname.endsWith('.apk')"), 'SW must never cache .apk binaries');
    assert.ok(swContent.includes("url.pathname.endsWith('.enc')"), 'SW must never cache .enc binaries');
    // Exclude version.json
    assert.ok(swContent.includes("url.pathname.endsWith('version.json')"), 'SW must never cache version.json');
    // ignoreSearch: true
    assert.ok(swContent.includes('ignoreSearch: true'), 'SW must support query-string version tolerance');
  });

  test('7. Service Worker implements clean cache activation and skipWaiting triggers', () => {
    const swContent = fs.readFileSync(swPath, 'utf-8');

    assert.ok(swContent.includes('self.skipWaiting()'), 'SW must call skipWaiting');
    assert.ok(swContent.includes('self.clients.claim()'), 'SW must call clients.claim');
    assert.ok(swContent.includes('caches.delete(k)'), 'SW must purge old caches on activation');
    assert.ok(swContent.includes('SKIP_WAITING'), 'SW must handle message-based skip waiting');
  });

  // ==========================================================================
  // 3. Cryptographic Verification & Release Integrity
  // ==========================================================================
  test('8. Production release APK exists and satisfies byte-for-byte SHA-256 and size integrity', () => {
    assert.ok(fs.existsSync(apkPath), 'Production APK must exist at downloads/NTM-Passbook-Android-v1.0.0.apk');

    const stats = fs.statSync(apkPath);
    assert.equal(stats.size, 11615753, 'Production APK must be exactly 11,615,753 bytes');

    const fileBuffer = fs.readFileSync(apkPath);
    const hash = crypto.createHash('sha256').update(fileBuffer).digest('hex').toUpperCase();
    assert.equal(
      hash,
      'BE038471CD7CBBF47407DD0D9249D06DFA4BE8D26E70EFDBF1827F74B110449C',
      'Production APK SHA-256 hash must be BE038471CD7CBBF47407DD0D9249D06DFA4BE8D26E70EFDBF1827F74B110449C'
    );
  });

  test('9. Production APK satisfies valid ZIP archive and Android package format structure', () => {
    const buffer = fs.readFileSync(apkPath);

    // ZIP Local File Header Magic: PK\x03\x04 (0x50, 0x4B, 0x03, 0x04)
    assert.equal(buffer[0], 0x50, 'Byte 0 must be P');
    assert.equal(buffer[1], 0x4b, 'Byte 1 must be K');
    assert.equal(buffer[2], 0x03, 'Byte 2 must be 0x03');
    assert.equal(buffer[3], 0x04, 'Byte 3 must be 0x04');

    // Confirm presence of AndroidManifest.xml inside the APK zip
    const stringData = buffer.toString('binary');
    assert.ok(stringData.includes('AndroidManifest.xml'), 'APK must contain compiled AndroidManifest.xml');
    assert.ok(stringData.includes('classes.dex'), 'APK must contain compiled classes.dex');
  });

  // ==========================================================================
  // 4. Secure Download Modal & Client Experience Audit
  // ==========================================================================
  test('10. Website HTML contains the Proton-Drive inspired secure download modal with all 6 states', () => {
    const html = fs.readFileSync(htmlPath, 'utf-8');

    assert.ok(html.includes('id="secure-download-modal"'), 'index.html must contain secure-download-modal');
    assert.ok(html.includes('id="step-1"'), 'Modal must contain step 1');
    assert.ok(html.includes('id="step-2"'), 'Modal must contain step 2');
    assert.ok(html.includes('id="step-3"'), 'Modal must contain step 3');
    assert.ok(html.includes('id="step-4"'), 'Modal must contain step 4');
    assert.ok(html.includes('id="step-5"'), 'Modal must contain step 5');
    assert.ok(html.includes('id="step-6"'), 'Modal must contain step 6');

    // Verify exact required Marathi stage texts from instructions
    assert.ok(html.includes('सुरक्षित डाउनलोड तयार होत आहे…'), 'Stage 1 text must match');
    assert.ok(html.includes('Protected package डाउनलोड होत आहे…'), 'Stage 2 text must match');
    assert.ok(html.includes('Package सुरक्षितपणे decrypt होत आहे…'), 'Stage 3 text must match');
    assert.ok(html.includes('Integrity (SHA-256) तपासली जात आहे…'), 'Stage 4 text must match');
    assert.ok(html.includes('APK signature तपासली जात आहे…'), 'Stage 5 text must match');
    assert.ok(html.includes('सुरक्षित डाउनलोड पूर्ण झाले'), 'Stage 6 text must match');
  });

  test('11. Website provides real Web Crypto SHA-256 verification and ZIP validation logic', () => {
    const html = fs.readFileSync(htmlPath, 'utf-8');

    // Web Crypto API digest
    assert.ok(html.includes("crypto.subtle.digest('SHA-256'"), 'Must compute SHA-256 via Web Crypto');
    assert.ok(html.includes('OFFICIAL_APK_SHA256'), 'Must reference official SHA-256 hash constant');
    assert.ok(html.includes('BE038471CD7CBBF47407DD0D9249D06DFA4BE8D26E70EFDBF1827F74B110449C'), 'Must verify against BE038471CD7CBBF47407DD0D9249D06DFA4BE8D26E70EFDBF1827F74B110449C');

    // ZIP magic bytes check
    assert.ok(html.includes('combinedBytes[0] !== 0x50'), 'Must verify ZIP magic byte 0x50');
    assert.ok(html.includes('combinedBytes[1] !== 0x4B'), 'Must verify ZIP magic byte 0x4B');

    // Fallback direct link
    assert.ok(html.includes('किंवा थेट डाउनलोड करा (Direct Download)'), 'Must provide direct download fallback');
  });

  test('12. Website includes PWA install prompt handler and accessibility prefers-reduced-motion', () => {
    const html = fs.readFileSync(htmlPath, 'utf-8');

    // beforeinstallprompt listener
    assert.ok(html.includes("window.addEventListener('beforeinstallprompt'"), 'Must handle beforeinstallprompt');
    assert.ok(html.includes('id="btn-pwa-install"'), 'Must have PWA install button');

    // prefers-reduced-motion CSS
    assert.ok(html.includes('@media (prefers-reduced-motion: reduce)'), 'Must include prefers-reduced-motion CSS rule');
  });

  // ==========================================================================
  // 5. Zero Secret Leak / Security Audit
  // ==========================================================================
  test('13. No encryption keys, private tokens, or secrets leaked in public downloads distribution', () => {
    const filesToAudit = [htmlPath, swPath, manifestPath, versionPath];

    for (const filePath of filesToAudit) {
      const content = fs.readFileSync(filePath, 'utf-8');

      // Check for private keys, secret keys, bearer tokens, or hardcoded passwords
      assert.ok(!content.includes('BEGIN PRIVATE KEY'), `${path.basename(filePath)} must not contain private keys`);
      assert.ok(!content.includes('BEGIN RSA PRIVATE KEY'), `${path.basename(filePath)} must not contain RSA private keys`);
      assert.ok(!content.includes('sk_live_'), `${path.basename(filePath)} must not contain live secret keys`);
      assert.ok(!content.includes('client_secret'), `${path.basename(filePath)} must not contain client secrets`);
      assert.ok(!content.includes('fake_key'), `${path.basename(filePath)} must not contain fake encryption keys`);
    }
  });

  test('14. Loop protection: session reload guard prevents infinite refresh loops', () => {
    const html = fs.readFileSync(htmlPath, 'utf-8');

    assert.ok(html.includes("sessionStorage.getItem('ntm_last_reloaded_version')"), 'Must guard version reload via sessionStorage');
    assert.ok(html.includes("sessionStorage.getItem('ntm_sw_controller_reloaded')"), 'Must guard controllerchange reload via sessionStorage');
    assert.ok(html.includes('history.scrollRestoration = \'manual\''), 'Must prevent midpoint scroll jumps on reload');
  });

  test('15. Website implements client Web Crypto AES-256-GCM SubtleCrypto.decrypt AEAD pipeline', () => {
    const html = fs.readFileSync(htmlPath, 'utf-8');

    // Confirm AES-GCM SubtleCrypto implementation in downloads/index.html
    assert.ok(html.includes('crypto.subtle.importKey'), 'Must import key for AES-GCM');
    assert.ok(html.includes("name: 'AES-GCM'"), 'Must specify AES-GCM algorithm');
    assert.ok(html.includes('crypto.subtle.decrypt'), 'Must perform SubtleCrypto.decrypt');
    assert.ok(html.includes('/api/release/download-token'), 'Must request download token');
    assert.ok(html.includes('/api/release/key'), 'Must request ephemeral release key');
    assert.ok(html.includes('decryptAeadPayload'), 'Must define AEAD decryption function');
  });

  test('16. Staging encrypted release package exists alongside unencrypted V1.0.0 APK without tampering', () => {
    const stagingEncPath = path.join(downloadsDir, 'staging-test-release-v2.0.0.apk.enc');
    const stagingManifestPath = path.join(downloadsDir, 'staging-release-manifest.json');

    assert.ok(fs.existsSync(stagingEncPath), 'Staging encrypted APK must exist');
    assert.ok(fs.existsSync(stagingManifestPath), 'Staging manifest must exist');

    // Confirm V1.0.0 APK remains intact
    const prodBytes = fs.readFileSync(apkPath);
    const hash = crypto.createHash('sha256').update(prodBytes).digest('hex').toUpperCase();
    assert.equal(hash, 'BE038471CD7CBBF47407DD0D9249D06DFA4BE8D26E70EFDBF1827F74B110449C');
  });
});
