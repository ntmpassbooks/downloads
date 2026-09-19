import test, { describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  checkServerHealth,
  getServerStatus,
  setServerStatus,
  resetServerAvailabilityForTesting,
  addServerStatusListener,
} from '../src/services/serverAvailability.service.js';
import {
  checkForAppUpdate,
  compareVersions,
  sanitizeDownloadUrl,
} from '../src/services/update.service.js';
import { apiRequest, setMockOfflineForTesting } from '../src/api/client.js';
import { APP_VERSION, OFFICIAL_DOWNLOAD_PAGE_URL } from '../src/config/version.js';

describe('NTM Passbook — Production Server-Down & App Version Integration Suite', () => {
  let originalFetch: any;

  beforeEach(() => {
    resetServerAvailabilityForTesting();
    setMockOfflineForTesting(null);
    originalFetch = (globalThis as any).fetch;
  });

  afterEach(() => {
    resetServerAvailabilityForTesting();
    setMockOfflineForTesting(null);
    (globalThis as any).fetch = originalFetch;
  });

  // ==========================================================================
  // 1. Backend Online
  // ==========================================================================
  test('1. Backend online: checkServerHealth returns isAvailable=true and status=ONLINE on HTTP 200', async () => {
    (globalThis as any).fetch = async (url: string) => {
      assert.ok(url.includes('/health'));
      return {
        ok: true,
        status: 200,
        json: async () => ({ status: 'healthy', environment: 'production' }),
      };
    };

    const res = await checkServerHealth(5000, true);
    assert.equal(res.isAvailable, true);
    assert.equal(res.status, 'ONLINE');
    assert.equal(res.statusCode, 200);
    assert.equal(getServerStatus(), 'ONLINE');
  });

  // ==========================================================================
  // 2. Backend Offline
  // ==========================================================================
  test('2. Backend offline: checkServerHealth returns isAvailable=false and status=OFFLINE on network failure', async () => {
    (globalThis as any).fetch = async () => {
      throw new Error('Connection refused / Tailscale unreachable');
    };

    const res = await checkServerHealth(5000, true);
    assert.equal(res.isAvailable, false);
    assert.equal(res.status, 'OFFLINE');
    assert.equal(res.statusCode, 0);
    assert.match(res.error || '', /सर्व्हर सध्या उपलब्ध नाही/);
    assert.match(res.error || '', /कृपया काही वेळाने पुन्हा प्रयत्न करा/);
    assert.equal(getServerStatus(), 'OFFLINE');
  });

  // ==========================================================================
  // 3. Network Timeout
  // ==========================================================================
  test('3. Network timeout: checkServerHealth aborts and returns OFFLINE when request exceeds timeout', async () => {
    (globalThis as any).fetch = async (_url: string, options: any) => {
      return new Promise((_resolve, reject) => {
        if (options?.signal) {
          options.signal.addEventListener('abort', () => {
            const err = new Error('The operation was aborted');
            err.name = 'AbortError';
            reject(err);
          });
        }
      });
    };

    const res = await checkServerHealth(50, true); // 50ms fast timeout
    assert.equal(res.isAvailable, false);
    assert.equal(res.status, 'OFFLINE');
    assert.equal(getServerStatus(), 'OFFLINE');
  });

  // ==========================================================================
  // 4. HTTP 503
  // ==========================================================================
  test('4. HTTP 503: Treated strictly as server unavailable in healthcheck and apiRequest', async () => {
    (globalThis as any).fetch = async () => {
      return {
        ok: false,
        status: 503,
        json: async () => ({ error: 'Service Unavailable' }),
      };
    };

    const healthRes = await checkServerHealth(5000, true);
    assert.equal(healthRes.isAvailable, false);
    assert.equal(healthRes.status, 'OFFLINE');
    assert.equal(healthRes.statusCode, 503);

    const apiRes = await apiRequest('/members');
    assert.equal(apiRes.success, false);
    assert.equal(apiRes.status, 503);
    assert.match(apiRes.error || '', /सर्व्हर सध्या उपलब्ध नाही/);
    assert.equal(getServerStatus(), 'OFFLINE');
  });

  // ==========================================================================
  // 5. HTTP 502
  // ==========================================================================
  test('5. HTTP 502: Bad gateway is treated as server unavailable', async () => {
    (globalThis as any).fetch = async () => {
      return {
        ok: false,
        status: 502,
        json: async () => ({ error: 'Bad Gateway' }),
      };
    };

    const res = await checkServerHealth(5000, true);
    assert.equal(res.isAvailable, false);
    assert.equal(res.status, 'OFFLINE');
    assert.equal(res.statusCode, 502);
  });

  // ==========================================================================
  // 6. HTTP 504
  // ==========================================================================
  test('6. HTTP 504: Gateway timeout is treated as server unavailable', async () => {
    (globalThis as any).fetch = async () => {
      return {
        ok: false,
        status: 504,
        json: async () => ({ error: 'Gateway Timeout' }),
      };
    };

    const res = await checkServerHealth(5000, true);
    assert.equal(res.isAvailable, false);
    assert.equal(res.status, 'OFFLINE');
    assert.equal(res.statusCode, 504);
  });

  // ==========================================================================
  // 7. HTTP 401 Remains Authentication Error
  // ==========================================================================
  test('7. 401 remains authentication error and is NOT treated as server down', async () => {
    (globalThis as any).fetch = async () => {
      return {
        ok: false,
        status: 401,
        json: async () => ({ error: 'Token expired' }),
      };
    };

    const res = await apiRequest('/auth/me');
    assert.equal(res.success, false);
    assert.equal(res.status, 401);
    assert.equal(res.error, 'Token expired');
    // Crucial: 401 confirms backend is reachable, NOT server-down
    assert.notEqual(getServerStatus(), 'OFFLINE');
  });

  // ==========================================================================
  // 8. HTTP 403 Remains Authorization Error
  // ==========================================================================
  test('8. 403 remains authorization error and is NOT treated as server down', async () => {
    (globalThis as any).fetch = async () => {
      return {
        ok: false,
        status: 403,
        json: async () => ({ error: 'Forbidden role' }),
      };
    };

    const res = await apiRequest('/admin/delete');
    assert.equal(res.success, false);
    assert.equal(res.status, 403);
    assert.equal(res.error, 'Forbidden role');
    assert.notEqual(getServerStatus(), 'OFFLINE');
  });

  // ==========================================================================
  // 9. HTTP 404 Remains API/Not-Found Error
  // ==========================================================================
  test('9. 404 remains API not-found error and is NOT treated as server down', async () => {
    (globalThis as any).fetch = async () => {
      return {
        ok: false,
        status: 404,
        json: async () => ({ error: 'Resource not found' }),
      };
    };

    const res = await apiRequest('/unknown-path');
    assert.equal(res.success, false);
    assert.equal(res.status, 404);
    assert.equal(res.error, 'Resource not found');
    assert.notEqual(getServerStatus(), 'OFFLINE');
  });

  // ==========================================================================
  // 10. Version Endpoint Unavailable
  // ==========================================================================
  test('10. Version endpoint unavailable: returns serverAvailable=false and marks server OFFLINE', async () => {
    (globalThis as any).fetch = async () => {
      throw new Error('Endpoint down');
    };

    const res = await checkForAppUpdate();
    assert.equal(res.serverAvailable, false);
    assert.equal(res.hasUpdate, false);
    assert.equal(res.isMandatory, false);
    assert.equal(getServerStatus(), 'OFFLINE');
  });

  // ==========================================================================
  // 11. Version Endpoint Available
  // ==========================================================================
  test('11. Version endpoint available: returns serverAvailable=true and parses version correctly', async () => {
    (globalThis as any).fetch = async () => {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          success: true,
          currentVersion: '1.0.0',
          latestVersion: '1.0.0',
          minimumSupportedVersion: '1.0.0',
          downloadPageUrl: 'https://ntmpassbooks.github.io/downloads/',
        }),
      };
    };

    const res = await checkForAppUpdate();
    assert.equal(res.serverAvailable, true);
    assert.equal(res.hasUpdate, false);
    assert.equal(res.isMandatory, false);
    assert.equal(getServerStatus(), 'ONLINE');
  });

  // ==========================================================================
  // 12. Update Available
  // ==========================================================================
  test('12. Update available: detects higher version when server is online', async () => {
    (globalThis as any).fetch = async () => {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          success: true,
          currentVersion: '1.0.0',
          latestVersion: '1.1.0',
          minimumSupportedVersion: '1.0.0',
          downloadPageUrl: 'https://ntmpassbooks.github.io/downloads/',
          releaseNotes: 'नवीन वैशिष्ट्ये',
        }),
      };
    };

    const res = await checkForAppUpdate();
    assert.equal(res.serverAvailable, true);
    assert.equal(res.hasUpdate, true);
    assert.equal(res.isMandatory, false);
    assert.equal(res.latestVersion, '1.1.0');
  });

  // ==========================================================================
  // 13. Update Required
  // ==========================================================================
  test('13. Update required: marks isMandatory=true when currentVersion < minimumSupportedVersion', async () => {
    (globalThis as any).fetch = async () => {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          success: true,
          currentVersion: '1.0.0',
          latestVersion: '2.0.0',
          minimumSupportedVersion: '1.5.0',
          downloadPageUrl: 'https://ntmpassbooks.github.io/downloads/',
        }),
      };
    };

    const res = await checkForAppUpdate();
    assert.equal(res.serverAvailable, true);
    assert.equal(res.hasUpdate, true);
    assert.equal(res.isMandatory, true);
  });

  // ==========================================================================
  // 14. Server Recovery
  // ==========================================================================
  test('14. Server recovery: detects transition from OFFLINE to ONLINE cleanly via listeners', async () => {
    let callCount = 0;
    const observedStatuses: string[] = [];

    addServerStatusListener((status) => {
      observedStatuses.push(status);
    });

    (globalThis as any).fetch = async () => {
      callCount++;
      if (callCount === 1) {
        throw new Error('Connection refused');
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({ status: 'healthy' }),
      };
    };

    // First attempt fails -> OFFLINE
    const res1 = await checkServerHealth(5000, true);
    assert.equal(res1.status, 'OFFLINE');

    // Second attempt recovers -> ONLINE
    const res2 = await checkServerHealth(5000, true);
    assert.equal(res2.status, 'ONLINE');
    assert.equal(getServerStatus(), 'ONLINE');
    assert.ok(observedStatuses.includes('OFFLINE'));
    assert.ok(observedStatuses.includes('ONLINE'));
  });

  // ==========================================================================
  // 15. Retry Button
  // ==========================================================================
  test('15. Retry button: forces immediate health verification and updates server status', async () => {
    setServerStatus('OFFLINE');
    assert.equal(getServerStatus(), 'OFFLINE');

    (globalThis as any).fetch = async () => ({
      ok: true,
      status: 200,
      json: async () => ({ status: 'healthy' }),
    });

    // Simulating user tapping 'पुन्हा प्रयत्न करा'
    const res = await checkServerHealth(5000, true);
    assert.equal(res.isAvailable, true);
    assert.equal(res.status, 'ONLINE');
    assert.equal(getServerStatus(), 'ONLINE');
  });

  // ==========================================================================
  // 16. No Infinite Retry / Debounce Protection
  // ==========================================================================
  test('16. No infinite retry: debounces rapid repeated health checks to prevent server hammering', async () => {
    let fetchCalls = 0;
    (globalThis as any).fetch = async () => {
      fetchCalls++;
      return {
        ok: true,
        status: 200,
        json: async () => ({ status: 'healthy' }),
      };
    };

    // First check (force = true)
    await checkServerHealth(5000, true);
    assert.equal(fetchCalls, 1);

    // Rapid second check without force -> throttled, returns cached result
    const res2 = await checkServerHealth(5000, false);
    assert.equal(fetchCalls, 1, 'Debounce should prevent secondary fetch within cooldown');
    assert.equal(res2.isAvailable, true);
  });

  // ==========================================================================
  // 17. No Financial Mutation While Offline
  // ==========================================================================
  test('17. No financial mutation while offline: strictly blocks POST/PUT/PATCH/DELETE locally', async () => {
    setMockOfflineForTesting(true);

    let fetchAttempted = false;
    (globalThis as any).fetch = async () => {
      fetchAttempted = true;
      throw new Error('Should not reach fetch');
    };

    const bishiRes = await apiRequest('/ledger/cash-payment', {
      method: 'POST',
      body: JSON.stringify({ recordId: '123', amount: 500 }),
    });

    assert.equal(fetchAttempted, false, 'Fetch must never be invoked while offline for mutations');
    assert.equal(bishiRes.success, false);
    assert.match(bishiRes.error || '', /इंटरनेट कनेक्शन उपलब्ध नाही/);
  });

  // ==========================================================================
  // 18. No False Financial Success
  // ==========================================================================
  test('18. No false financial success: mutation failure during server down returns unconfirmed notice', async () => {
    setMockOfflineForTesting(false);

    (globalThis as any).fetch = async () => {
      throw new Error('Sudden server drop during transaction');
    };

    const mutationRes = await apiRequest('/bishi/pay', {
      method: 'POST',
      body: JSON.stringify({ amount: 1000 }),
    });

    assert.equal(mutationRes.success, false);
    assert.notEqual(mutationRes.success, true);
    // Explicit Marathi unconfirmed message
    assert.match(mutationRes.error || '', /व्यवहाराची सर्व्हरकडून पुष्टी मिळालेली नाही/);
    assert.match(mutationRes.error || '', /कृपया पुन्हा प्रयत्न करण्यापूर्वी व्यवहाराची स्थिती तपासा/);
    assert.ok(!mutationRes.error?.includes('यशस्वी'));
  });

  // ==========================================================================
  // 19. No Update Dialog When Server Is Down
  // ==========================================================================
  test('19. No update dialog when server is down: update check edge case', async () => {
    (globalThis as any).fetch = async () => {
      throw new Error('Backend completely offline');
    };

    const updateResult = await checkForAppUpdate();
    assert.equal(updateResult.serverAvailable, false);
    assert.equal(updateResult.hasUpdate, false);
    assert.equal(updateResult.isMandatory, false);
    assert.equal(getServerStatus(), 'OFFLINE');

    // Component condition: update modal only opens if (serverAvailable && hasUpdate)
    const shouldOpenModal = Boolean(updateResult.serverAvailable && updateResult.hasUpdate);
    assert.equal(shouldOpenModal, false, 'Update modal must strictly remain closed when server is down');
  });

  // ==========================================================================
  // 20. Existing Update Dialog Still Works
  // ==========================================================================
  test('20. Existing update dialog still works with official repository URL', () => {
    assert.equal(APP_VERSION, '1.0.0');
    assert.equal(OFFICIAL_DOWNLOAD_PAGE_URL, 'https://ntmpassbooks.github.io/downloads/');
    assert.equal(
      sanitizeDownloadUrl('https://ntmpassbooks.github.io/downloads/'),
      'https://ntmpassbooks.github.io/downloads/'
    );
    assert.equal(compareVersions('1.0.0', '1.0.1'), -1);
    assert.equal(compareVersions('1.0.0', '1.0.0'), 0);
  });
});
