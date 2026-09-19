function resolveApiBaseUrl(): string {
  const envUrl = (import.meta as any).env?.VITE_API_URL || (import.meta as any).env?.VITE_API_BASE_URL;
  if (envUrl && typeof envUrl === 'string' && envUrl.trim().length > 0) {
    const trimmed = envUrl.trim().replace(/\/+$/, '');
    return trimmed.endsWith('/api') ? trimmed : `${trimmed}/api`;
  }
  return '/api';
}

export const API_BASE = resolveApiBaseUrl();

export function getApiUrl(endpoint: string): string {
  const cleanEndpoint = endpoint.startsWith('/api/')
    ? endpoint.substring(4)
    : endpoint.startsWith('/')
    ? endpoint
    : `/${endpoint}`;
  return `${API_BASE}${cleanEndpoint}`;
}

export interface ApiResponse<T = any> {
  success: boolean;
  status?: number;
  data?: T;
  error?: string;
  details?: any;
  [key: string]: any;
}

let mockOfflineForTesting: boolean | null = null;

export function setMockOfflineForTesting(offline: boolean | null): void {
  mockOfflineForTesting = offline;
}

export function isOffline(): boolean {
  if (mockOfflineForTesting !== null) {
    return mockOfflineForTesting;
  }
  return typeof navigator !== 'undefined' && typeof navigator.onLine === 'boolean' && !navigator.onLine;
}


function getStoredToken(): string | null {
  try {
    if (typeof localStorage !== 'undefined') {
      const token = localStorage.getItem('ntm_token');
      if (token) return token;
    }
    if (typeof sessionStorage !== 'undefined') {
      return sessionStorage.getItem('ntm_token');
    }
  } catch {
    // Ignore
  }
  return null;
}

function clearStoredAuth(): void {
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.removeItem('ntm_token');
      localStorage.removeItem('ntm_user');
      localStorage.removeItem('ntm_org');
    }
    if (typeof sessionStorage !== 'undefined') {
      sessionStorage.removeItem('ntm_token');
    }
  } catch {
    // Ignore
  }
}

type NetworkActivityListener = (isReachable: boolean, statusCode?: number) => void;
let networkActivityListener: NetworkActivityListener | null = null;

export function setNetworkActivityListener(listener: NetworkActivityListener | null): void {
  networkActivityListener = listener;
}

export async function apiRequest<T = any>(
  endpoint: string,
  options: RequestInit = {}
): Promise<ApiResponse<T>> {
  const token = getStoredToken();

  const headers: HeadersInit = {
    'Content-Type': 'application/json',
    ...(options.headers || {}),
  };

  if (token) {
    (headers as Record<string, string>)['Authorization'] = `Bearer ${token}`;
  }

  const method = (options.method || 'GET').toUpperCase();
  const offlineState = isOffline();

  // CRITICAL OFFLINE MUTATION GUARD:
  // Financial mutations and state modifications MUST NOT be attempted, queued, or simulated offline.
  if (offlineState && method !== 'GET') {
    return {
      success: false,
      status: 0,
      error: 'इंटरनेट कनेक्शन उपलब्ध नाही. (ऑफलाइन असताना आर्थिक व्यवहार व बदल सेव्ह होत नाहीत.)',
    };
  }

  try {
    const url = getApiUrl(endpoint);

    const response = await fetch(url, {
      ...options,
      headers,
    });

    const status = response.status;
    let data: any = {};
    try {
      data = await response.json();
    } catch {
      data = {};
    }

    if (status === 401) {
      clearStoredAuth();
    }

    // 502, 503, 504 are explicit server-down conditions
    if (status === 502 || status === 503 || status === 504) {
      networkActivityListener?.(false, status);
      const isMutation = method !== 'GET';
      return {
        success: false,
        status,
        error: isMutation
          ? 'व्यवहाराची सर्व्हरकडून पुष्टी मिळालेली नाही. कृपया पुन्हा प्रयत्न करण्यापूर्वी व्यवहाराची स्थिती तपासा.'
          : 'सर्व्हरशी संपर्क होऊ शकला नाही. सर्व्हर सध्या उपलब्ध नाही. कृपया काही वेळाने पुन्हा प्रयत्न करा.',
        details: data.details,
      };
    }

    // Reachable response (both 2xx and 4xx application errors)
    networkActivityListener?.(true, status);

    if (!response.ok) {
      return {
        success: false,
        status,
        error: data.error || `HTTP Error ${status}`,
        details: data.details,
      };
    }

    return { ...data, status, success: data.success !== false };
  } catch (err: any) {
    networkActivityListener?.(false, 0);
    const offlineNow = isOffline();
    const isMutation = method !== 'GET';
    const serverUnavailableMsg = isMutation
      ? 'व्यवहाराची सर्व्हरकडून पुष्टी मिळालेली नाही. कृपया पुन्हा प्रयत्न करण्यापूर्वी व्यवहाराची स्थिती तपासा.'
      : 'सर्व्हरशी संपर्क होऊ शकला नाही. सर्व्हर सध्या उपलब्ध नाही. कृपया काही वेळाने पुन्हा प्रयत्न करा.';

    return {
      success: false,
      status: 0,
      error: offlineNow
        ? 'इंटरनेट कनेक्शन उपलब्ध नाही. (ऑफलाइन असताना आर्थिक व्यवहार व बदल सेव्ह होत नाहीत.)'
        : serverUnavailableMsg,
    };
  }
}

