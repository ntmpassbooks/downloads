import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import {
  ServerStatus,
  getServerStatus,
  setServerStatus,
  addServerStatusListener,
  checkServerHealth,
} from '../services/serverAvailability.service.js';

interface ServerAvailabilityContextType {
  serverStatus: ServerStatus;
  isServerDown: boolean;
  isChecking: boolean;
  checkAvailability: (force?: boolean) => Promise<boolean>;
  retryConnection: () => Promise<boolean>;
  markServerDown: () => void;
  markServerOnline: () => void;
}

const ServerAvailabilityContext = createContext<ServerAvailabilityContextType | undefined>(undefined);

export const ServerAvailabilityProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [serverStatus, setStatusState] = useState<ServerStatus>(() => getServerStatus());

  useEffect(() => {
    // Subscribe to service-level status changes
    const unsubscribe = addServerStatusListener((newStatus) => {
      setStatusState(newStatus);
    });

    // Listen to browser/device online & offline events
    const handleWindowOffline = () => {
      setServerStatus('OFFLINE');
    };

    const handleWindowOnline = () => {
      // When device network reconnects, probe server health immediately
      checkServerHealth(6000, true).catch(() => {});
    };

    if (typeof window !== 'undefined') {
      window.addEventListener('offline', handleWindowOffline);
      window.addEventListener('online', handleWindowOnline);
    }

    return () => {
      unsubscribe();
      if (typeof window !== 'undefined') {
        window.removeEventListener('offline', handleWindowOffline);
        window.removeEventListener('online', handleWindowOnline);
      }
    };
  }, []);

  const checkAvailability = useCallback(async (force = false): Promise<boolean> => {
    try {
      const result = await checkServerHealth(6000, force);
      return result.isAvailable;
    } catch {
      return false;
    }
  }, []);

  const retryConnection = useCallback(async (): Promise<boolean> => {
    try {
      const result = await checkServerHealth(6000, true);
      return result.isAvailable;
    } catch {
      return false;
    }
  }, []);

  const markServerDown = useCallback(() => {
    setServerStatus('OFFLINE');
  }, []);

  const markServerOnline = useCallback(() => {
    setServerStatus('ONLINE');
  }, []);

  const isServerDown = serverStatus === 'OFFLINE';
  const isChecking = serverStatus === 'CHECKING';

  return (
    <ServerAvailabilityContext.Provider
      value={{
        serverStatus,
        isServerDown,
        isChecking,
        checkAvailability,
        retryConnection,
        markServerDown,
        markServerOnline,
      }}
    >
      {children}
    </ServerAvailabilityContext.Provider>
  );
};

export function useServerAvailability(): ServerAvailabilityContextType {
  const context = useContext(ServerAvailabilityContext);
  if (!context) {
    throw new Error('useServerAvailability must be used within a ServerAvailabilityProvider');
  }
  return context;
}
