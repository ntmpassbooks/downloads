import React, { createContext, useContext, useState, useEffect } from 'react';
import { App as CapApp } from '@capacitor/app';
import { Capacitor } from '@capacitor/core';

export type NavTab = 'dashboard' | 'members' | 'bishi' | 'transactions' | 'loans' | 'expenses' | 'reports' | 'profile';

interface NavigationContextType {
  currentTab: NavTab;
  setCurrentTab: (tab: NavTab) => void;
  isMenuOpen: boolean;
  setIsMenuOpen: (open: boolean) => void;
  toggleMenu: () => void;
  closeMenu: () => void;
  navigateTo: (tab: NavTab, sectionId?: string) => void;
}

const NavigationContext = createContext<NavigationContextType | undefined>(undefined);

export const NavigationProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [currentTab, setCurrentTab] = useState<NavTab>('dashboard');
  const [isMenuOpen, setIsMenuOpen] = useState(false);

  const toggleMenu = () => setIsMenuOpen((prev) => !prev);
  const closeMenu = () => setIsMenuOpen(false);

  const navigateTo = (tab: NavTab, sectionId?: string) => {
    setCurrentTab(tab);
    closeMenu();
    if (sectionId) {
      setTimeout(() => {
        const el = document.getElementById(sectionId);
        if (el) {
          el.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
      }, 100);
    }
  };

  // Close on Escape or Android back key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isMenuOpen) {
        closeMenu();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isMenuOpen]);

  // Handle browser back button closing the menu if open
  useEffect(() => {
    if (!isMenuOpen) return;

    window.history.pushState({ menuOpen: true }, '');
    const handlePopState = () => {
      closeMenu();
    };

    window.addEventListener('popstate', handlePopState);
    return () => {
      window.removeEventListener('popstate', handlePopState);
    };
  }, [isMenuOpen]);

  // Native Android hardware Back button integration
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;

    const backListenerPromise = CapApp.addListener('backButton', () => {
      // 1. Open dialog / modal must be dismissed first
      const openDialogs = document.querySelectorAll(
        '[role="dialog"], [role="alertdialog"], .fixed.inset-0.z-50'
      );
      if (openDialogs.length > 0) {
        const topDialog = openDialogs[openDialogs.length - 1];
        const closeBtn =
          topDialog.querySelector<HTMLElement>('button[aria-label="बंद करा"], button[data-modal-close]') ||
          Array.from(topDialog.querySelectorAll<HTMLButtonElement>('button')).find(
            (b) =>
              b.innerText.includes('रद्द करा') ||
              b.innerText.includes('बंद करा') ||
              b.innerText.includes('मागे जा') ||
              b.innerText.includes('समजले') ||
              b.innerText.includes('ठीक आहे')
          );
        if (closeBtn) {
          closeBtn.click();
          return;
        }
        window.dispatchEvent(
          new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true, cancelable: true })
        );
        return;
      }

      if (isMenuOpen) {
        closeMenu();
        return;
      }
      if (currentTab !== 'dashboard') {
        setCurrentTab('dashboard');
        return;
      }
      CapApp.exitApp();
    });

    return () => {
      backListenerPromise.then((handle) => handle.remove());
    };
  }, [isMenuOpen, currentTab]);

  return (
    <NavigationContext.Provider
      value={{
        currentTab,
        setCurrentTab,
        isMenuOpen,
        setIsMenuOpen,
        toggleMenu,
        closeMenu,
        navigateTo,
      }}
    >
      {children}
    </NavigationContext.Provider>
  );
};

export const useNavigation = (): NavigationContextType => {
  const context = useContext(NavigationContext);
  if (!context) {
    throw new Error('useNavigation must be used within a NavigationProvider');
  }
  return context;
};

export const useOptionalNavigation = (): NavigationContextType | undefined => {
  return useContext(NavigationContext);
};
