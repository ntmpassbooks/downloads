import React from 'react';
import { useAuth } from '../context/AuthContext.js';

interface MobileFrameProps {
  children: React.ReactNode;
}

export const MobileFrame: React.FC<MobileFrameProps> = ({ children }) => {
  const { isLoading, initError } = useAuth();
  const isSplash = isLoading || !!initError;

  return (
    <div className="w-full min-h-[100dvh] h-[100dvh] bg-slate-100 dark:bg-slate-900 flex justify-center items-stretch overflow-hidden select-none">
      {/* Universal Adaptive Application Container */}
      <main
        role="main"
        className={`w-full max-w-2xl lg:max-w-4xl h-full flex flex-col shadow-lg bg-white overflow-hidden relative ${
          isSplash ? 'bg-amber-600' : 'bg-slate-50'
        }`}
      >
        <div className={`flex-1 flex flex-col ${isSplash ? 'overflow-hidden bg-amber-600' : 'overflow-y-auto bg-slate-50'}`}>
          {children}
        </div>
      </main>
    </div>
  );
};
