import React, { useState, useEffect, useCallback } from 'react';
import { ServerAvailabilityProvider, useServerAvailability } from './context/ServerAvailabilityContext.js';
import { AuthProvider, useAuth } from './context/AuthContext.js';
import { NavigationProvider } from './context/NavigationContext.js';
import { NotificationProvider } from './context/NotificationContext.js';
import { MobileFrame } from './components/MobileFrame.js';
import { Navbar } from './components/Navbar.js';
import { SplashScreen } from './components/SplashScreen.js';
import { NotificationModal } from './components/NotificationModal.js';
import { NetworkStatusBanner } from './components/NetworkStatusBanner.js';
import { ServerDownBanner } from './components/ServerDownBanner.js';
import { AppUpdateModal } from './components/AppUpdateModal.js';
import { AlertModalProvider } from './context/AlertModalContext.js';
import { checkForAppUpdate, AppUpdateInfo } from './services/update.service.js';
import { LoginPage } from './pages/LoginPage.js';
import { DashboardPage } from './pages/DashboardPage.js';

const MainContent: React.FC = () => {
  const { user, organization, isLoading, initError, retryInit, refreshUser } = useAuth();
  const { isServerDown } = useServerAvailability();
  const [updateInfo, setUpdateInfo] = useState<AppUpdateInfo | null>(null);
  const [isUpdateModalOpen, setIsUpdateModalOpen] = useState(false);

  const runUpdateCheck = useCallback(() => {
    // Only check for updates after initial auth/splash is complete and server is not down
    if (!isLoading && !initError && !isServerDown) {
      checkForAppUpdate()
        .then((info) => {
          // Strictly suppress update modal if server is unavailable
          if (info && info.serverAvailable && info.hasUpdate) {
            setUpdateInfo(info);
            setIsUpdateModalOpen(true);
          } else {
            setIsUpdateModalOpen(false);
          }
        })
        .catch(() => {
          // Silent fallback
        });
    }
  }, [isLoading, initError, isServerDown]);

  useEffect(() => {
    runUpdateCheck();
  }, [runUpdateCheck]);

  if (isLoading || initError) {
    return <SplashScreen error={initError} onRetry={retryInit} mandalName={organization?.name} />;
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden relative">
      <NetworkStatusBanner />
      <ServerDownBanner
        onRetrySuccess={() => {
          runUpdateCheck();
          if (user) {
            refreshUser().catch(() => {});
          }
        }}
      />
      <Navbar />
      {user ? <DashboardPage /> : <LoginPage />}
      <AppUpdateModal
        isOpen={isUpdateModalOpen}
        updateInfo={updateInfo}
        onDismiss={() => setIsUpdateModalOpen(false)}
      />
    </div>
  );
};

export const App: React.FC = () => {
  return (
    <ServerAvailabilityProvider>
      <AuthProvider>
        <NotificationProvider>
          <NavigationProvider>
            <AlertModalProvider>
              <MobileFrame>
                <MainContent />
                <NotificationModal />
              </MobileFrame>
            </AlertModalProvider>
          </NavigationProvider>
        </NotificationProvider>
      </AuthProvider>
    </ServerAvailabilityProvider>
  );
};

export default App;
