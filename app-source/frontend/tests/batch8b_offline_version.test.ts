import test, { describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  compareVersions,
  sanitizeDownloadUrl,
  checkForAppUpdate,
} from '../src/services/update.service.js';
import { apiRequest, setMockOfflineForTesting } from '../src/api/client.js';
import { APP_VERSION, OFFICIAL_DOWNLOAD_PAGE_URL } from '../src/config/version.js';

describe('NTM Passbook — Batch 8B: Frontend Offline Hardening & Version Suite', () => {
  let originalFetch: any;

  beforeEach(() => {
    setMockOfflineForTesting(null);
    originalFetch = (globalThis as any).fetch;
  });

  afterEach(() => {
    setMockOfflineForTesting(null);
    (globalThis as any).fetch = originalFetch;
  });

  // ==========================================================================
  // 1. Semantic Version Comparison
  // ==========================================================================
  test('1. compareVersions accurately handles semantic version ordering', () => {
    assert.equal(compareVersions('1.0.0', '1.0.0'), 0);
    assert.equal(compareVersions('v1.0.0', '1.0.0'), 0);
    assert.equal(compareVersions('1.0.0', '1.0.1'), -1);
    assert.equal(compareVersions('1.0.1', '1.0.0'), 1);
    assert.equal(compareVersions('1.0.1', '1.1.0'), -1);
    assert.equal(compareVersions('1.1.0', '2.0.0'), -1);
    assert.equal(compareVersions('2.0.0', '1.1.0'), 1);
  });

  test('2. compareVersions rejects malformed version strings safely', () => {
    assert.throws(() => compareVersions('', '1.0.0'));
    assert.throws(() => compareVersions('1.0', '1.0.0'));
    assert.throws(() => compareVersions('1.0.0.0', '1.0.0'));
    assert.throws(() => compareVersions('abc', '1.0.0'));
  });

  // ==========================================================================
  // 3. Download URL Sanitization
  // ==========================================================================
  test('3. sanitizeDownloadUrl protects against malicious schemes', () => {
    assert.equal(
      sanitizeDownloadUrl('https://ntmpassbooks.github.io/downloads/'),
      'https://ntmpassbooks.github.io/downloads/'
    );
    assert.equal(sanitizeDownloadUrl('/download'), '/download');

    // Deprecated legacy URL rejected and defaulted to official URL
    const legacyUrl = 'https://' + 'santoshkoli1.github.io/ntm-passbook/';
    assert.equal(sanitizeDownloadUrl(legacyUrl), OFFICIAL_DOWNLOAD_PAGE_URL);
    assert.ok(!OFFICIAL_DOWNLOAD_PAGE_URL.includes('santoshkoli1'));

    assert.equal(sanitizeDownloadUrl('javascript:alert(1)'), OFFICIAL_DOWNLOAD_PAGE_URL);
    assert.equal(sanitizeDownloadUrl('data:text/html,bad'), OFFICIAL_DOWNLOAD_PAGE_URL);
    assert.equal(sanitizeDownloadUrl(undefined), OFFICIAL_DOWNLOAD_PAGE_URL);
  });

  // ==========================================================================
  // 4. Update Check Service Graceful Fallback
  // ==========================================================================
  test('4. checkForAppUpdate safely returns no update when server is offline or unreachable', async () => {
    (globalThis as any).fetch = async () => {
      throw new Error('Network offline');
    };

    const result = await checkForAppUpdate();
    assert.equal(result.hasUpdate, false);
    assert.equal(result.isMandatory, false);
    assert.equal(result.currentVersion, APP_VERSION);
  });

  test('5. checkForAppUpdate detects higher version and mandatory updates', async () => {
    (globalThis as any).fetch = async () => {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          success: true,
          currentVersion: '1.0.0',
          latestVersion: '1.2.0',
          minimumSupportedVersion: '1.1.0',
          versionCode: 2,
          downloadPageUrl: 'https://ntmpassbooks.github.io/downloads/',
          releaseNotes: 'सुरक्षा व कार्यक्षमता सुधारणा',
          updateMessage: 'NTM Passbook ची नवीन आवृत्ती उपलब्ध आहे.',
        }),
      };
    };

    const result = await checkForAppUpdate();
    assert.equal(result.hasUpdate, true);
    assert.equal(result.isMandatory, true); // Installed 1.0.0 < minSupported 1.1.0
    assert.equal(result.latestVersion, '1.2.0');
    assert.equal(result.downloadPageUrl, 'https://ntmpassbooks.github.io/downloads/');
    assert.equal(result.releaseNotes, 'सुरक्षा व कार्यक्षमता सुधारणा');
  });

  // ==========================================================================
  // 5. Offline Mutation Guard
  // ==========================================================================
  test('6. apiRequest immediately blocks financial mutations (POST/PUT/PATCH/DELETE) when offline', async () => {
    setMockOfflineForTesting(true);

    let fetchCalled = false;
    (globalThis as any).fetch = async () => {
      fetchCalled = true;
      throw new Error('Fetch should not be called');
    };

    // Attempting POST mutation when offline
    const postRes = await apiRequest('/ledger/cash-payment', {
      method: 'POST',
      body: JSON.stringify({ amount: 1000 }),
    });

    assert.equal(fetchCalled, false, 'Fetch must not be invoked when offline for mutating request');
    assert.equal(postRes.success, false);
    assert.equal(postRes.status, 0);
    assert.match(postRes.error || '', /इंटरनेट कनेक्शन उपलब्ध नाही/);
    assert.match(postRes.error || '', /ऑफलाइन असताना आर्थिक व्यवहार व बदल सेव्ह होत नाहीत/);

    // Attempting PATCH mutation when offline
    const patchRes = await apiRequest('/members/123/status', {
      method: 'PATCH',
      body: JSON.stringify({ isActive: false }),
    });
    assert.equal(patchRes.success, false);
    assert.match(patchRes.error || '', /इंटरनेट कनेक्शन उपलब्ध नाही/);

    // Attempting DELETE mutation when offline
    const deleteRes = await apiRequest('/expenses/123', {
      method: 'DELETE',
    });
    assert.equal(deleteRes.success, false);
    assert.match(deleteRes.error || '', /इंटरनेट कनेक्शन उपलब्ध नाही/);
  });

  test('7. apiRequest allows requests when online and handles network failure with safe Marathi message', async () => {
    setMockOfflineForTesting(false);

    // Simulating sudden connection drop during fetch
    (globalThis as any).fetch = async () => {
      throw new Error('Connection refused');
    };

    const res = await apiRequest('/app/version');
    assert.equal(res.success, false);
    assert.equal(res.status, 0);
    assert.match(res.error || '', /सर्व्हरशी संपर्क होऊ शकला नाही/);
  });

  test('8. Version constants verify APP_VERSION=1.0.0 and OFFICIAL_DOWNLOAD_PAGE_URL=https://ntmpassbooks.github.io/downloads/', () => {
    assert.equal(APP_VERSION, '1.0.0');
    assert.equal(OFFICIAL_DOWNLOAD_PAGE_URL, 'https://ntmpassbooks.github.io/downloads/');
  });
});
