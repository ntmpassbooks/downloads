import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const downloadsDir = path.resolve(process.cwd(), '../downloads');
const htmlPath = path.join(downloadsDir, 'index.html');
const html = fs.readFileSync(htmlPath, 'utf8');

describe('NTM Passbook — Batch 13.7: Part 10 Full Failure & Security Validation Suite', () => {
  // ==========================================================================
  // Failure Condition 1 & 2: Network Failure & Server Unavailable
  // ==========================================================================
  test('1 & 2. Network Failure & Server Unavailable: Error halts pipeline, shows error notice and direct fallback', () => {
    assert.ok(html.includes("if (!response.ok) {"), 'Must detect HTTP failure status on package download');
    assert.ok(html.includes("डाउनलोड सर्व्हर त्रुटी"), 'Must display user-facing server error message');
    assert.ok(html.includes("errorBox.classList.remove('hidden')"), 'Must display error card upon failure');
    assert.ok(html.includes("sd-pulse-dot')?.classList.remove('animate-ping')"), 'Must stop pulse animation upon failure');
    assert.ok(html.includes("थेट डाउनलोड करा"), 'Must provide direct download fallback button in error state');
  });

  // ==========================================================================
  // Failure Condition 3, 4, 5, 6: Token Lifecycle & Key Exchange Failures
  // ==========================================================================
  test('3, 4, 5, 6. Token Expiry, Replay, Invalid Token & Version Mismatch: Token errors abort immediately', () => {
    assert.ok(html.includes("if (!tokenRes.ok) {"), 'Must validate token issuance HTTP response');
    assert.ok(html.includes("if (!keyRes.ok) {"), 'Must validate key exchange HTTP response');
    assert.ok(html.includes("की-एक्सचेंज अयशस्वी"), 'Must handle key exchange rejection gracefully');
    assert.ok(html.includes("रीप्ले किंवा कालबाह्य टोकन"), 'Must detect replay or token expiration in client handler');
  });

  // ==========================================================================
  // Failure Condition 7: Wrong Key Decryption
  // ==========================================================================
  test('7. Wrong Key Decryption: Web Crypto SubtleCrypto.decrypt fails when incorrect key is provided', async () => {
    const original = Buffer.from('VALID_NTM_APK_PAYLOAD_DATA');
    const correctKey = crypto.randomBytes(32);
    const wrongKey = crypto.randomBytes(32);
    const iv = crypto.randomBytes(12);

    const cipher = crypto.createCipheriv('aes-256-gcm', correctKey, iv);
    const ct = Buffer.concat([cipher.update(original), cipher.final()]);
    const tag = cipher.getAuthTag();
    const payload = Buffer.concat([ct, tag]);

    const webWrongKey = await crypto.webcrypto.subtle.importKey(
      'raw',
      wrongKey,
      { name: 'AES-GCM' },
      false,
      ['decrypt']
    );

    await assert.rejects(
      async () => {
        await crypto.webcrypto.subtle.decrypt({ name: 'AES-GCM', iv }, webWrongKey, payload);
      },
      /OperationError/
    );
  });

  // ==========================================================================
  // Failure Condition 8: Tampered Ciphertext
  // ==========================================================================
  test('8. Tampered Ciphertext: Web Crypto rejects tampered ciphertext via AEAD authentication tag', async () => {
    const original = Buffer.from('VALID_NTM_APK_PAYLOAD_DATA');
    const key = crypto.randomBytes(32);
    const iv = crypto.randomBytes(12);

    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    const ct = Buffer.concat([cipher.update(original), cipher.final()]);
    const tag = cipher.getAuthTag();

    // Tamper single byte in ciphertext
    ct[4] = ct[4] ^ 0xff;
    const payload = Buffer.concat([ct, tag]);

    const webKey = await crypto.webcrypto.subtle.importKey('raw', key, { name: 'AES-GCM' }, false, ['decrypt']);

    await assert.rejects(
      async () => {
        await crypto.webcrypto.subtle.decrypt({ name: 'AES-GCM', iv }, webKey, payload);
      },
      /OperationError/
    );
  });

  // ==========================================================================
  // Failure Condition 9: Tampered IV
  // ==========================================================================
  test('9. Tampered IV: Web Crypto rejects corrupt IV via AEAD authentication tag', async () => {
    const original = Buffer.from('VALID_NTM_APK_PAYLOAD_DATA');
    const key = crypto.randomBytes(32);
    const iv = crypto.randomBytes(12);

    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    const ct = Buffer.concat([cipher.update(original), cipher.final()]);
    const tag = cipher.getAuthTag();
    const payload = Buffer.concat([ct, tag]);

    // Corrupt IV
    const corruptedIv = Buffer.from(iv);
    corruptedIv[0] = corruptedIv[0] ^ 0x01;

    const webKey = await crypto.webcrypto.subtle.importKey('raw', key, { name: 'AES-GCM' }, false, ['decrypt']);

    await assert.rejects(
      async () => {
        await crypto.webcrypto.subtle.decrypt({ name: 'AES-GCM', iv: corruptedIv }, webKey, payload);
      },
      /OperationError/
    );
  });

  // ==========================================================================
  // Failure Condition 10: SHA-256 Mismatch Guard
  // ==========================================================================
  test('10. SHA-256 Mismatch Guard: Pipeline halts, throws security error and blocks handoff if hash diverges', () => {
    assert.ok(html.includes("if (computedHash !== expectedSha256) {"), 'Must strictly compare computed hash with expected hash');
    assert.ok(html.includes("सुरक्षा कारणास्तव डाउनलोड थांबवले"), 'Must declare security halt on SHA-256 mismatch');
    assert.ok(html.includes("फाइलची अखंडता तपासता आली नाही"), 'Must display integrity failure notice');
  });

  // ==========================================================================
  // Failure Condition 11: Invalid ZIP Magic Header
  // ==========================================================================
  test('11. Invalid ZIP Header Guard: Pipeline halts if file does not begin with PK\\x03\\x04', () => {
    assert.ok(
      html.includes("combinedBytes[0] !== 0x50 || combinedBytes[1] !== 0x4B || combinedBytes[2] !== 0x03 || combinedBytes[3] !== 0x04"),
      'Must check all 4 bytes of ZIP magic header (0x50, 0x4B, 0x03, 0x04)'
    );
    assert.ok(html.includes("ZIP हेडर आढळले नाही"), 'Must throw error if ZIP magic header is missing');
  });

  // ==========================================================================
  // Failure Condition 12 & 13: Unsupported Web Crypto or Streams Fallback
  // ==========================================================================
  test('12 & 13. Web Crypto & Streams Feature Detection: Graceful fallback on legacy browsers', () => {
    assert.ok(html.includes("!hasWebCrypto || !hasStreams"), 'Must detect presence of Web Crypto and Streams');
    assert.ok(html.includes("या ब्राउझरमध्ये सुरक्षित direct download सुरू करत आहोत…"), 'Must notify user of direct download fallback');
  });

  // ==========================================================================
  // Failure Condition 14: Loop Protection & Session Storage
  // ==========================================================================
  test('14. Session Reload Guard: Prevents infinite reload loops during update or storage issues', () => {
    assert.ok(html.includes("sessionStorage.getItem('ntm_last_reloaded_version')"), 'Must guard against reload loops');
    assert.ok(html.includes("sessionStorage.setItem('ntm_last_reloaded_version'"), 'Must store last reloaded version');
  });
});
