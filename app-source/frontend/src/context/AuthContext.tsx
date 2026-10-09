import React, { createContext, useContext, useState, useEffect } from 'react';
import { Capacitor } from '@capacitor/core';
import { App as CapApp } from '@capacitor/app';
import { apiRequest } from '../api/client.js';
import { FirebaseAuthService } from '../services/firebaseAuth.service.js';
import { OfflinePassbookCacheService } from '../services/offlinePassbookCache.service.js';

export type Role = 'PRESIDENT' | 'TREASURER' | 'MEMBER';

export interface User {
  id: string;
  organizationId: string;
  phone: string;
  fullName: string;
  role: Role;
  isActive?: boolean;
  createdAt?: string;
  updatedAt?: string;
}

export interface Organization {
  id: string;
  name: string;
  code: string;
  registrationNumber: string | null;
}

interface AuthContextType {
  user: User | null;
  organization: Organization | null;
  token: string | null;
  isLoading: boolean;
  initError: string | null;
  retryInit: () => void;
  login: (phone: string, pin: string, rememberMe?: boolean) => Promise<{ success: boolean; error?: string }>;
  logout: () => Promise<void>;
  updateToken: (newToken: string, updatedUser?: User) => void;
  refreshUser: () => Promise<void>;
  setAuthSession: (
    token: string,
    user: User,
    organization: Organization,
    rememberMe?: boolean,
    firebaseToken?: string
  ) => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [organization, setOrganization] = useState<Organization | null>(null);
  const [token, setToken] = useState<string | null>(
    () => localStorage.getItem('ntm_token') || sessionStorage.getItem('ntm_token')
  );
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [initError, setInitError] = useState<string | null>(null);

  // Validate session and server connectivity on app initialization with minimum 10-second splash
  const checkAuth = React.useCallback(async () => {
    setIsLoading(true);
    setInitError(null);

    const startTime = Date.now();
    const MIN_SPLASH_DURATION_MS = 10000;

    const waitForMinDuration = async () => {
      const elapsed = Date.now() - startTime;
      const remaining = MIN_SPLASH_DURATION_MS - elapsed;
      if (remaining > 0) {
        await new Promise((resolve) => setTimeout(resolve, remaining));
      }
    };

    const activeToken = localStorage.getItem('ntm_token') || sessionStorage.getItem('ntm_token');

    if (activeToken) {
      // 1. Session restoration & validation for authenticated user
      try {
        const authPromise = apiRequest('/auth/me').then((res) => {
          if (res.success && res.user && res.organization) {
            // Update immediately so splash screen displays dynamic Mandal name during startup
            setUser(res.user);
            setOrganization(res.organization);
            setToken(activeToken);
          }
          return res;
        });

        const [res] = await Promise.all([
          authPromise,
          waitForMinDuration(),
        ]);

        if (res.success && res.user && res.organization) {
          setUser(res.user);
          setOrganization(res.organization);
          setToken(activeToken);
          localStorage.setItem('ntm_user', JSON.stringify(res.user));
          localStorage.setItem('ntm_org', JSON.stringify(res.organization));
          setInitError(null);
          setIsLoading(false);

          // Batch 7B: Firebase client session synchronization (non-blocking)
          if (res.firebaseToken) {
            FirebaseAuthService.signInWithCustomToken(res.firebaseToken).catch(() => {
              // Safe non-blocking degradation: backend auth remains authoritative
            });
          }
        } else if (res.status === 401) {
          // Token expired or invalid: reset credentials and transition to login
          OfflinePassbookCacheService.clearAllPassbookCaches();
          setUser(null);
          setOrganization(null);
          setToken(null);
          localStorage.removeItem('ntm_token');
          sessionStorage.removeItem('ntm_token');
          localStorage.removeItem('ntm_user');
          localStorage.removeItem('ntm_org');
          setInitError(null);
          setIsLoading(false);
        } else {
          // Network or server connectivity issue: try offline session restoration
          const cachedUserStr = localStorage.getItem('ntm_user');
          const cachedOrgStr = localStorage.getItem('ntm_org');
          if (cachedUserStr && cachedOrgStr) {
            try {
              const cachedUser = JSON.parse(cachedUserStr);
              const cachedOrg = JSON.parse(cachedOrgStr);
              if (cachedUser?.id && cachedOrg?.id) {
                setUser(cachedUser);
                setOrganization(cachedOrg);
                setToken(activeToken);
                setInitError(null);
                setIsLoading(false);
                return;
              }
            } catch {
              // Fall through to error
            }
          }
          setInitError(res.error || 'सर्व्हर सध्या उपलब्ध नाही. कृपया काही वेळाने पुन्हा प्रयत्न करा.');
          setIsLoading(false);
        }
      } catch {
        await waitForMinDuration();
        const cachedUserStr = localStorage.getItem('ntm_user');
        const cachedOrgStr = localStorage.getItem('ntm_org');
        if (cachedUserStr && cachedOrgStr) {
          try {
            const cachedUser = JSON.parse(cachedUserStr);
            const cachedOrg = JSON.parse(cachedOrgStr);
            if (cachedUser?.id && cachedOrg?.id) {
              setUser(cachedUser);
              setOrganization(cachedOrg);
              setToken(activeToken);
              setInitError(null);
              setIsLoading(false);
              return;
            }
          } catch {
            // Fall through to error
          }
        }
        setInitError('सर्व्हर सध्या उपलब्ध नाही. कृपया काही वेळाने पुन्हा प्रयत्न करा.');
        setIsLoading(false);
      }
    } else {
      // 2. Fresh launch without saved session: verify real backend connectivity
      setUser(null);
      setOrganization(null);
      setToken(null);
      try {
        const [res] = await Promise.all([
          apiRequest('/auth/registration-status'),
          waitForMinDuration(),
        ]);

        if (res.status === 0 || res.status === 502 || res.status === 503 || res.status === 504) {
          // Server unreachable
          setInitError(res.error || 'सर्व्हर सध्या उपलब्ध नाही. कृपया काही वेळाने पुन्हा प्रयत्न करा.');
          setIsLoading(false);
        } else {
          // Server is alive, ready for login
          setUser(null);
          setOrganization(null);
          setToken(null);
          setInitError(null);
          setIsLoading(false);
        }
      } catch {
        await waitForMinDuration();
        setInitError('सर्व्हर सध्या उपलब्ध नाही. कृपया काही वेळाने पुन्हा प्रयत्न करा.');
        setIsLoading(false);
      }
    }

  }, []);

  useEffect(() => {
    checkAuth();

    let appStateHandle: any = null;
    if (Capacitor.isNativePlatform()) {
      CapApp.addListener('appStateChange', (state) => {
        if (state.isActive) {
          checkAuth();
        }
      }).then((handle) => {
        appStateHandle = handle;
      }).catch(() => {});
    }

    return () => {
      if (appStateHandle && typeof appStateHandle.remove === 'function') {
        appStateHandle.remove();
      }
    };
  }, [checkAuth]);

  const retryInit = () => {
    checkAuth();
  };

  const login = async (phone: string, pin: string, rememberMe = true) => {
    const res = await apiRequest('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ phone, pin }),
    });

    if (res.success && res.token && res.user && res.organization) {
      if (rememberMe) {
        localStorage.setItem('ntm_token', res.token);
      } else {
        sessionStorage.setItem('ntm_token', res.token);
      }
      localStorage.setItem('ntm_user', JSON.stringify(res.user));
      localStorage.setItem('ntm_org', JSON.stringify(res.organization));
      setToken(res.token);
      setUser(res.user);
      setOrganization(res.organization);

      // Batch 7B: Firebase client session synchronization (non-blocking)
      // A Firebase failure must NEVER turn a successful backend login into a failed login
      if (res.firebaseToken) {
        FirebaseAuthService.signInWithCustomToken(res.firebaseToken).catch(() => {
          // Safe non-blocking degradation
        });
      }

      return { success: true };
    }

    return {
      success: false,
      error: res.error || 'लॉग इन अपयशी ठरले',
    };
  };

  const setAuthSession = (
    newToken: string,
    newUser: User,
    newOrg: Organization,
    rememberMe = true,
    firebaseToken?: string
  ) => {
    if (rememberMe) {
      localStorage.setItem('ntm_token', newToken);
    } else {
      sessionStorage.setItem('ntm_token', newToken);
    }
    localStorage.setItem('ntm_user', JSON.stringify(newUser));
    localStorage.setItem('ntm_org', JSON.stringify(newOrg));
    setToken(newToken);
    setUser(newUser);
    setOrganization(newOrg);

    // Batch 7B: Firebase client session synchronization if custom token is provided
    if (firebaseToken) {
      FirebaseAuthService.signInWithCustomToken(firebaseToken).catch(() => {
        // Safe non-blocking degradation
      });
    }
  };

  const logout = async () => {
    try {
      await apiRequest('/auth/logout', { method: 'POST' });
    } catch {
      // Proceed with local logout regardless of network state
    }

    // Batch 7B: Safe Firebase sign-out (non-blocking)
    try {
      await FirebaseAuthService.signOut();
    } catch {
      // Safe non-blocking degradation
    }

    OfflinePassbookCacheService.clearAllPassbookCaches();
    localStorage.removeItem('ntm_token');
    sessionStorage.removeItem('ntm_token');
    localStorage.removeItem('ntm_user');
    localStorage.removeItem('ntm_org');
    setToken(null);
    setUser(null);
    setOrganization(null);
    await checkAuth();
  };

  const updateToken = (newToken: string, updatedUser?: User) => {
    localStorage.setItem('ntm_token', newToken);
    setToken(newToken);
    if (updatedUser) {
      setUser(updatedUser);
    }
  };

  const refreshUser = async () => {
    const currentToken = localStorage.getItem('ntm_token') || sessionStorage.getItem('ntm_token');
    if (!currentToken) return;
    const res = await apiRequest('/auth/me');
    if (res.success && res.user && res.organization) {
      setUser(res.user);
      setOrganization(res.organization);

      // Batch 7B: Firebase client session synchronization on profile refresh
      if (res.firebaseToken) {
        FirebaseAuthService.signInWithCustomToken(res.firebaseToken).catch(() => {
          // Safe non-blocking degradation
        });
      }
    }
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        organization,
        token,
        isLoading,
        initError,
        retryInit,
        login,
        logout,
        updateToken,
        refreshUser,
        setAuthSession,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export function useAuth(): AuthContextType {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
