process.env.NODE_ENV = 'test';
process.env.DB_PATH = './data/ntm_test.sqlite';

import test, { before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { Server } from 'node:http';
import { createApp } from '../src/app.js';
import { seedDatabase } from '../src/db/seed.js';
import { closeDatabase } from '../src/db/connection.js';
import { VersionService } from '../src/modules/version/version.service.js';

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

async function apiGet(endpoint: string, token?: string) {
  const headers: Record<string, string> = {};
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const res = await fetch(`${baseUrl}${endpoint}`, {
    method: 'GET',
    headers,
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}

describe('NTM Passbook — Batch 8B: Version & Offline Hardening Suite', () => {
  // ==========================================================================
  // 1. Semantic Version Comparison
  // ==========================================================================
  test('1. Semantic version comparison handles major, minor, patch and equality accurately', () => {
    // Exact equality
    assert.equal(VersionService.compareVersions('1.0.0', '1.0.0'), 0);
    assert.equal(VersionService.compareVersions('v1.1.0', '1.1.0'), 0);
    assert.equal(VersionService.compareVersions('2.4.5', 'v2.4.5'), 0);

    // Patch differences: 1.0.0 < 1.0.1
    assert.equal(VersionService.compareVersions('1.0.0', '1.0.1'), -1);
    assert.equal(VersionService.compareVersions('1.0.1', '1.0.0'), 1);

    // Minor differences: 1.0.1 < 1.1.0
    assert.equal(VersionService.compareVersions('1.0.1', '1.1.0'), -1);
    assert.equal(VersionService.compareVersions('1.1.0', '1.0.1'), 1);

    // Major differences: 1.1.0 < 2.0.0
    assert.equal(VersionService.compareVersions('1.1.0', '2.0.0'), -1);
    assert.equal(VersionService.compareVersions('2.0.0', '1.1.0'), 1);

    // Multi-digit components: 1.9.0 < 1.10.0
    assert.equal(VersionService.compareVersions('1.9.0', '1.10.0'), -1);
    assert.equal(VersionService.compareVersions('1.10.0', '1.9.0'), 1);
  });

  test('2. Semantic version comparison rejects invalid or malformed version strings', () => {
    assert.throws(() => VersionService.compareVersions('', '1.0.0'));
    assert.throws(() => VersionService.compareVersions('1.0', '1.0.0'));
    assert.throws(() => VersionService.compareVersions('invalid', '1.0.0'));
    assert.throws(() => VersionService.compareVersions('1.0.0.0', '1.0.0'));
    assert.throws(() => VersionService.compareVersions('1.0.0', 'abc'));
  });

  // ==========================================================================
  // 3. Security: Download URL Sanitization
  // ==========================================================================
  test('3. Download URL sanitizer allows trusted HTTP/HTTPS and rejects malicious schemas', () => {
    // Allowed HTTPS and HTTP
    assert.equal(
      VersionService.sanitizeDownloadUrl('https://ntmpassbooks.github.io/downloads/'),
      'https://ntmpassbooks.github.io/downloads/'
    );
    // Arbitrary external domains rejected and defaulted to official URL
    assert.equal(
      VersionService.sanitizeDownloadUrl('http://arbitrary-external.com/app'),
      VersionService.OFFICIAL_DOWNLOAD_URL
    );

    // Relative path allowed
    assert.equal(VersionService.sanitizeDownloadUrl('/downloads'), '/downloads');

    // Deprecated legacy URL explicitly rejected and defaulted to official URL
    const legacyUrl = 'https://' + 'santoshkoli1.github.io/ntm-passbook/';
    assert.equal(VersionService.sanitizeDownloadUrl(legacyUrl), VersionService.OFFICIAL_DOWNLOAD_URL);
    assert.ok(!VersionService.OFFICIAL_DOWNLOAD_URL.includes('santoshkoli1'));

    // Malicious schemes blocked and safely defaulted to official download page
    assert.equal(
      VersionService.sanitizeDownloadUrl('javascript:alert(1)'),
      VersionService.OFFICIAL_DOWNLOAD_URL
    );
    assert.equal(
      VersionService.sanitizeDownloadUrl('data:text/html,<script>alert(1)</script>'),
      VersionService.OFFICIAL_DOWNLOAD_URL
    );
    assert.equal(
      VersionService.sanitizeDownloadUrl('file:///etc/passwd'),
      VersionService.OFFICIAL_DOWNLOAD_URL
    );
    assert.equal(
      VersionService.sanitizeDownloadUrl(''),
      VersionService.OFFICIAL_DOWNLOAD_URL
    );
  });

  // ==========================================================================
  // 4. Public Version Metadata API
  // ==========================================================================
  test('4. GET /api/app/version is publicly accessible and returns authoritative defaults', async () => {
    const res = await apiGet('/api/app/version');
    assert.equal(res.status, 200);
    assert.equal(res.data.success, true);
    assert.equal(res.data.currentVersion, '1.0.0');
    assert.equal(typeof res.data.latestVersion, 'string');
    assert.equal(typeof res.data.minimumSupportedVersion, 'string');
    assert.equal(typeof res.data.versionCode, 'number');
    assert.equal(res.data.updateRequired, false);
    assert.equal(res.data.isMandatory, false);
    assert.equal(res.data.downloadPageUrl, 'https://ntmpassbooks.github.io/downloads/');
    assert.match(res.data.updateMessage, /NTM Passbook/);

    // Verify zero secrets leaked in payload
    const jsonStr = JSON.stringify(res.data);
    assert.ok(!jsonStr.includes('private_key'));
    assert.ok(!jsonStr.includes('SESSION_SECRET'));
    assert.ok(!jsonStr.includes('PIN_ENCRYPTION_KEY'));
    assert.ok(!jsonStr.includes('BANK_ENCRYPTION_KEY'));
  });

  test('5. Version metadata correctly flags updateRequired and isMandatory based on clientVersion', () => {
    const originalLatest = process.env.APP_LATEST_VERSION;
    const originalMin = process.env.APP_MIN_SUPPORTED_VERSION;

    try {
      process.env.APP_LATEST_VERSION = '1.2.0';
      process.env.APP_MIN_SUPPORTED_VERSION = '1.1.0';

      // Client with 1.2.0 is up-to-date
      const upToDate = VersionService.getVersionMetadata('1.2.0');
      assert.equal(upToDate.updateRequired, false);
      assert.equal(upToDate.isMandatory, false);

      // Client with 1.1.5 has optional update (>= min, but < latest)
      const optional = VersionService.getVersionMetadata('1.1.5');
      assert.equal(optional.updateRequired, true);
      assert.equal(optional.isMandatory, false);

      // Client with 1.0.0 has mandatory update (< min)
      const mandatory = VersionService.getVersionMetadata('1.0.0');
      assert.equal(mandatory.updateRequired, true);
      assert.equal(mandatory.isMandatory, true);

      // Malformed client version does not cause mandatory lock
      const malformed = VersionService.getVersionMetadata('bad-version');
      assert.equal(malformed.updateRequired, false);
      assert.equal(malformed.isMandatory, false);
    } finally {
      process.env.APP_LATEST_VERSION = originalLatest;
      process.env.APP_MIN_SUPPORTED_VERSION = originalMin;
    }
  });

  test('6. Version constants verify CURRENT_VERSION=1.0.0, versionCode=1 and OFFICIAL_DOWNLOAD_URL=https://ntmpassbooks.github.io/downloads/', () => {
    assert.equal(VersionService.CURRENT_VERSION, '1.0.0');
    assert.equal(VersionService.CURRENT_VERSION_CODE, 1);
    assert.equal(VersionService.OFFICIAL_DOWNLOAD_URL, 'https://ntmpassbooks.github.io/downloads/');
  });
});
