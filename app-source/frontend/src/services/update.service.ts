import { apiRequest } from '../api/client.js';
import { APP_VERSION, OFFICIAL_DOWNLOAD_PAGE_URL } from '../config/version.js';
import { setServerStatus } from './serverAvailability.service.js';

export interface AppUpdateInfo {
  hasUpdate: boolean;
  isMandatory: boolean;
  currentVersion: string;
  latestVersion: string;
  minimumSupportedVersion: string;
  releaseNotes: string;
  downloadPageUrl: string;
  updateMessage: string;
  serverAvailable?: boolean;
  serverError?: string;
}


/**
 * Compares two semantic version strings (e.g. '1.0.0', '1.0.1', '1.1.0', '2.0.0').
 * Returns:
 *  -1 if v1 < v2
 *   0 if v1 === v2
 *   1 if v1 > v2
 * Throws Error on malformed format.
 */
export function compareVersions(v1: string, v2: string): number {
  if (typeof v1 !== 'string' || typeof v2 !== 'string') {
    throw new Error('Invalid version string');
  }

  const clean1 = v1.trim().replace(/^v/i, '');
  const clean2 = v2.trim().replace(/^v/i, '');

  const semverRegex = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;
  if (!semverRegex.test(clean1) || !semverRegex.test(clean2)) {
    throw new Error('Invalid semantic version format');
  }

  const parse = (v: string): [number, number, number] => {
    const core = v.split('-')[0];
    const parts = core.split('.').map((p) => {
      const n = parseInt(p, 10);
      if (isNaN(n) || n < 0) throw new Error('Invalid version segment');
      return n;
    });
    return [parts[0], parts[1], parts[2]];
  };

  const [maj1, min1, pat1] = parse(clean1);
  const [maj2, min2, pat2] = parse(clean2);

  if (maj1 !== maj2) return maj1 > maj2 ? 1 : -1;
  if (min1 !== min2) return min1 > min2 ? 1 : -1;
  if (pat1 !== pat2) return pat1 > pat2 ? 1 : -1;

  return 0;
}

/**
 * Sanitizes and verifies download URL to prevent malicious URL schemes or javascript: injection.
 */
export function sanitizeDownloadUrl(url: string | undefined): string {
  if (!url || typeof url !== 'string') {
    return OFFICIAL_DOWNLOAD_PAGE_URL;
  }

  const trimmed = url.trim();

  if (trimmed.startsWith('/') && !trimmed.startsWith('//')) {
    return trimmed;
  }

  try {
    const parsed = new URL(trimmed);
    if (
      (parsed.protocol === 'https:' || parsed.protocol === 'http:') &&
      parsed.hostname === 'ntmpassbooks.github.io'
    ) {
      return parsed.toString();
    }
  } catch {
    // Malformed URL
  }

  return OFFICIAL_DOWNLOAD_PAGE_URL;
}

/**
 * Checks backend for application update metadata.
 * Safe degradation: Never blocks or interrupts the app if update endpoint is unreachable.
 */
export async function checkForAppUpdate(): Promise<AppUpdateInfo> {
  const safeFallback: AppUpdateInfo = {
    hasUpdate: false,
    isMandatory: false,
    currentVersion: APP_VERSION,
    latestVersion: APP_VERSION,
    minimumSupportedVersion: APP_VERSION,
    releaseNotes: '',
    downloadPageUrl: OFFICIAL_DOWNLOAD_PAGE_URL,
    updateMessage: '',
    serverAvailable: false,
  };

  try {
    const res = await apiRequest<any>(`/app/version?clientVersion=${encodeURIComponent(APP_VERSION)}`);

    if (!res.success || !res.latestVersion) {
      if (res.status === 0 || res.status === 502 || res.status === 503 || res.status === 504) {
        setServerStatus('OFFLINE');
      }
      return {
        ...safeFallback,
        serverAvailable: false,
        serverError: res.error,
      };
    }

    setServerStatus('ONLINE');

    const latestVersion = String(res.latestVersion || APP_VERSION);
    const minSupported = String(res.minimumSupportedVersion || APP_VERSION);

    // Semantic comparison against installed version
    let hasUpdate = false;
    let isMandatory = false;

    try {
      hasUpdate = compareVersions(APP_VERSION, latestVersion) < 0;
      isMandatory = compareVersions(APP_VERSION, minSupported) < 0;
    } catch {
      // Malformed version strings from server: do not force update
      hasUpdate = false;
      isMandatory = false;
    }

    return {
      hasUpdate,
      isMandatory,
      currentVersion: APP_VERSION,
      latestVersion,
      minimumSupportedVersion: minSupported,
      releaseNotes: typeof res.releaseNotes === 'string' ? res.releaseNotes : '',
      downloadPageUrl: sanitizeDownloadUrl(res.downloadPageUrl),
      updateMessage: typeof res.updateMessage === 'string' ? res.updateMessage : 'NTM Passbook ची नवीन आवृत्ती उपलब्ध आहे.',
      serverAvailable: true,
    };
  } catch {
    setServerStatus('OFFLINE');
    // Network or parse failure: silently return fallback
    return safeFallback;
  }
}

