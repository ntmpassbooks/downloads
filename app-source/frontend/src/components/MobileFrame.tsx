import React from 'react';
import { useAuth } from '../context/AuthContext.js';

interface MobileFrameProps {
  children: React.ReactNode;
}

export const MobileFrame: React.FC<MobileFrameProps> = ({ children }) => {
  const { isLoading, initError } = useAuth();
  const isSplash = isLoading || !!initError;

  return (
    <div className={`w-full min-h-screen h-screen min-h-full h-full ${isSplash ? 'bg-gradient-to-b from-orange-600 via-orange-500 to-amber-600' : 'bg-slate-50'} flex justify-center items-stretch overflow-hidden select-none`}>
      {/* Universal Adaptive Application Container */}
      <main
        role="main"
        className={`w-full ${isSplash ? 'max-w-none shadow-none bg-gradient-to-b from-orange-600 via-orange-500 to-amber-600' : 'max-w-2xl lg:max-w-4xl shadow-lg bg-slate-50'} h-full flex flex-col overflow-hidden relative`}
      >
        <div className={`flex-1 flex flex-col h-full ${isSplash ? 'overflow-hidden bg-gradient-to-b from-orange-600 via-orange-500 to-amber-600' : 'overflow-y-auto bg-slate-50'}`}>
          {children}
        </div>
      </main>
    </div>
  );
};
