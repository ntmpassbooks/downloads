import { useState, useEffect, useCallback } from 'react';

export interface ViewportState {
  width: number;
  height: number;
  visualWidth: number;
  visualHeight: number;
  orientation: 'portrait' | 'landscape';
  devicePixelRatio: number;
  isKeyboardOpen: boolean;
  isCompact: boolean;      // Available width < 360px
  isMobile: boolean;       // Available width < 640px
  isTablet: boolean;       // Available width >= 640px && < 1024px
  isDesktop: boolean;      // Available width >= 1024px
  isShortScreen: boolean;  // Available height < 600px (landscape or small viewports)
}

const getInitialViewport = (): ViewportState => {
  if (typeof window === 'undefined') {
    return {
      width: 360,
      height: 640,
      visualWidth: 360,
      visualHeight: 640,
      orientation: 'portrait',
      devicePixelRatio: 1,
      isKeyboardOpen: false,
      isCompact: false,
      isMobile: true,
      isTablet: false,
      isDesktop: false,
      isShortScreen: false,
    };
  }

  const width = window.innerWidth;
  const height = window.innerHeight;
  const visualWidth = window.visualViewport ? window.visualViewport.width : width;
  const visualHeight = window.visualViewport ? window.visualViewport.height : height;
  const orientation = width >= height ? 'landscape' : 'portrait';
  const devicePixelRatio = window.devicePixelRatio || 1;
  const isKeyboardOpen = window.visualViewport ? height - visualHeight > 150 : false;

  return {
    width,
    height,
    visualWidth,
    visualHeight,
    orientation,
    devicePixelRatio,
    isKeyboardOpen,
    isCompact: width < 360,
    isMobile: width < 640,
    isTablet: width >= 640 && width < 1024,
    isDesktop: width >= 1024,
    isShortScreen: height < 600,
  };
};

export const useViewport = (): ViewportState => {
  const [viewport, setViewport] = useState<ViewportState>(getInitialViewport);

  const handleUpdate = useCallback(() => {
    if (typeof window === 'undefined') return;

    const width = window.innerWidth;
    const height = window.innerHeight;
    const visualWidth = window.visualViewport ? window.visualViewport.width : width;
    const visualHeight = window.visualViewport ? window.visualViewport.height : height;
    const orientation = width >= height ? 'landscape' : 'portrait';
    const devicePixelRatio = window.devicePixelRatio || 1;
    // On touch devices, if visualViewport shrinks substantially compared to window.innerHeight, keyboard is active
    const isKeyboardOpen = window.visualViewport ? (height - visualHeight) > 150 : false;

    setViewport({
      width,
      height,
      visualWidth,
      visualHeight,
      orientation,
      devicePixelRatio,
      isKeyboardOpen,
      isCompact: width < 360,
      isMobile: width < 640,
      isTablet: width >= 640 && width < 1024,
      isDesktop: width >= 1024,
      isShortScreen: visualHeight < 600,
    });
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    let rafId: number | null = null;
    const scheduleUpdate = () => {
      if (rafId !== null) cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(handleUpdate);
    };

    window.addEventListener('resize', scheduleUpdate, { passive: true });
    window.addEventListener('orientationchange', scheduleUpdate, { passive: true });

    if (window.visualViewport) {
      window.visualViewport.addEventListener('resize', scheduleUpdate, { passive: true });
      window.visualViewport.addEventListener('scroll', scheduleUpdate, { passive: true });
    }

    // Initial update
    handleUpdate();

    return () => {
      if (rafId !== null) cancelAnimationFrame(rafId);
      window.removeEventListener('resize', scheduleUpdate);
      window.removeEventListener('orientationchange', scheduleUpdate);
      if (window.visualViewport) {
        window.visualViewport.removeEventListener('resize', scheduleUpdate);
        window.visualViewport.removeEventListener('scroll', scheduleUpdate);
      }
    };
  }, [handleUpdate]);

  return viewport;
};
