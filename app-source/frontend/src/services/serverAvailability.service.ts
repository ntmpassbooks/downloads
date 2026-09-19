import { getApiUrl, isOffline, setNetworkActivityListener } from '../api/client.js';

export type ServerStatus = 'ONLINE' | 'CHECKING' | 'OFFLINE' | 'UNKNOWN';

export interface CheckHealthResult {
  isAvailable: boolean;
  status: ServerStatus;
  statusCode?: number;
  error?: string;
}

type StatusChangeListener = (status: ServerStatus) => void;

let currentServerStatus: ServerStatus = 'UNKNOWN';
let lastCheckTimestamp = 0;
let inFlightCheck: Promise<CheckHealthResult> | null = null;
const listeners = new Set<StatusChangeListener>();

// Listen to API client activity to track server reachability reactively
setNetworkActivityListener((isReachable, statusCode) => {
  if (!isReachable) {
    // Only mark offline if status code is 0 (network drop) or 502/503/504
    if (statusCode === 0 || statusCode === 502 || statusCode === 503 || statusCode === 504) {
      setServerStatus('OFFLINE');
    }
  } else {
    // Reachable response (2xx or 4xx application errors)
    if (currentServerStatus === 'OFFLINE' || currentServerStatus === 'UNKNOWN') {
      setServerStatus('ONLINE');
    }
  }
});


// Minimum cooldown between automatic health checks to prevent hammering the backend
const MIN_CHECK_INTERVAL_MS = 1500;

export function getServerStatus(): ServerStatus {
  return currentServerStatus;
}

export function setServerStatus(newStatus: ServerStatus): void {
  if (currentServerStatus !== newStatus) {
    currentServerStatus = newStatus;
    notifyListeners(newStatus);
  }
}

export function addServerStatusListener(listener: StatusChangeListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function notifyListeners(status: ServerStatus): void {
  for (const listener of listeners) {
    try {
      listener(status);
    } catch {
      // Prevent listener errors from interrupting state notification
    }
  }
}

/**
 * Resets state for testing purposes.
 */
export function resetServerAvailabilityForTesting(): void {
  currentServerStatus = 'UNKNOWN';
  lastCheckTimestamp = 0;
  inFlightCheck = null;
  listeners.clear();
}

/**
 * Performs a health check against GET /api/health.
 * Distinguishes genuine server-down (network failure, timeout, 502/503/504)
 * from normal API responses.
 *
 * @param timeoutMs Timeout in milliseconds (default 6000ms)
 * @param force If true, ignores debounce interval
 */
export async function checkServerHealth(
  timeoutMs = 6000,
  force = false
): Promise<CheckHealthResult> {
  // If device is offline (no network connection at all)
  if (isOffline()) {
    setServerStatus('OFFLINE');
    return {
      isAvailable: false,
      status: 'OFFLINE',
      statusCode: 0,
      error: 'इंटरनेट कनेक्शन उपलब्ध नाही. सर्व्हर सध्या उपलब्ध नाही. कृपया काही वेळाने पुन्हा प्रयत्न करा.',
    };

  }

  const now = Date.now();
  // Return in-flight request if one is currently pending
  if (inFlightCheck) {
    return inFlightCheck;
  }

  // Throttle rapid repeated checks unless force is requested
  if (!force && now - lastCheckTimestamp < MIN_CHECK_INTERVAL_MS && currentServerStatus !== 'UNKNOWN') {
    return {
      isAvailable: currentServerStatus === 'ONLINE',
      status: currentServerStatus,
    };
  }

  setServerStatus('CHECKING');
  lastCheckTimestamp = now;

  inFlightCheck = (async (): Promise<CheckHealthResult> => {
    const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timeoutId = controller
      ? setTimeout(() => {
          controller.abort();
        }, timeoutMs)
      : null;

    try {
      const url = getApiUrl('/health');
      const fetchOptions: RequestInit = {
        method: 'GET',
        headers: {
          Accept: 'application/json',
        },
      };

      if (controller) {
        fetchOptions.signal = controller.signal;
      }

      const response = await fetch(url, fetchOptions);
      if (timeoutId) clearTimeout(timeoutId);

      const status = response.status;

      // 502, 503, 504 are explicit server-down conditions
      if (status === 502 || status === 503 || status === 504) {
        setServerStatus('OFFLINE');
        return {
          isAvailable: false,
          status: 'OFFLINE',
          statusCode: status,
          error: 'सर्व्हर सध्या उपलब्ध नाही. कृपया काही वेळाने पुन्हा प्रयत्न करा.',
        };
      }

      // Normal application errors (401, 403, 404, 409, 422) indicate the server is reachable and online
      // HTTP 200 is healthy
      if (response.ok || (status >= 400 && status < 500)) {
        setServerStatus('ONLINE');
        return {
          isAvailable: true,
          status: 'ONLINE',
          statusCode: status,
        };
      }

      // Any other unexpected server error (500, etc.)
      setServerStatus('OFFLINE');
      return {
        isAvailable: false,
        status: 'OFFLINE',
        statusCode: status,
        error: 'सर्व्हर सध्या उपलब्ध नाही. कृपया काही वेळाने पुन्हा प्रयत्न करा.',
      };
    } catch (err: any) {
      if (timeoutId) clearTimeout(timeoutId);

      setServerStatus('OFFLINE');
      return {
        isAvailable: false,
        status: 'OFFLINE',
        statusCode: 0,
        error: 'सर्व्हर सध्या उपलब्ध नाही. कृपया काही वेळाने पुन्हा प्रयत्न करा.',
      };
    } finally {
      inFlightCheck = null;
    }
  })();

  return inFlightCheck;
}
