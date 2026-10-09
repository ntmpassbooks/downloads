import React from 'react';
import { createPortal } from 'react-dom';

interface ModalPortalProps {
  children: React.ReactNode;
}

/**
 * Universally portals modal overlays directly to document.body.
 * This guarantees the modal backdrop escapes any ancestor clipping,
 * transforms, overflow containers, or flex-column scroll contexts,
 * ensuring true viewport-relative horizontal and vertical centering.
 */
export const ModalPortal: React.FC<ModalPortalProps> = ({ children }) => {
  if (typeof document === 'undefined') {
    return <>{children}</>;
  }

  return createPortal(children, document.body);
};

export default ModalPortal;
