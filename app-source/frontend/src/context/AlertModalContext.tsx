import React, { createContext, useContext, useState, useCallback } from 'react';
import { CenteredAlertModal, AlertModalType } from '../components/CenteredAlertModal.js';

interface AlertOptions {
  type?: AlertModalType;
  title: string;
  message: string | React.ReactNode;
  confirmText?: string;
  cancelText?: string;
  onConfirm?: () => void;
  onCancel?: () => void;
  showCancel?: boolean;
}

interface AlertModalContextType {
  showAlert: (options: AlertOptions) => void;
  showSuccess: (title: string, message: string | React.ReactNode, onConfirm?: () => void) => void;
  showError: (title: string, message: string | React.ReactNode, onConfirm?: () => void) => void;
  showConfirm: (
    title: string,
    message: string | React.ReactNode,
    onConfirm: () => void,
    onCancel?: () => void
  ) => void;
  closeAlert: () => void;
}

const AlertModalContext = createContext<AlertModalContextType | undefined>(undefined);

export const AlertModalProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [modalState, setModalState] = useState<{
    isOpen: boolean;
    type: AlertModalType;
    title: string;
    message: string | React.ReactNode;
    confirmText?: string;
    cancelText?: string;
    onConfirm?: () => void;
    onCancel?: () => void;
    showCancel?: boolean;
  }>({
    isOpen: false,
    type: 'info',
    title: '',
    message: '',
  });

  const closeAlert = useCallback(() => {
    setModalState((prev) => {
      if (prev.onCancel) prev.onCancel();
      return { ...prev, isOpen: false };
    });
  }, []);

  const showAlert = useCallback(
    (options: AlertOptions) => {
      setModalState({
        isOpen: true,
        type: options.type || 'info',
        title: options.title,
        message: options.message,
        confirmText: options.confirmText,
        cancelText: options.cancelText,
        onConfirm: () => {
          if (options.onConfirm) options.onConfirm();
          setModalState((prev) => ({ ...prev, isOpen: false }));
        },
        onCancel: options.onCancel,
        showCancel: options.showCancel,
      });
    },
    []
  );

  const showSuccess = useCallback(
    (title: string, message: string | React.ReactNode, onConfirm?: () => void) => {
      showAlert({
        type: 'success',
        title,
        message,
        confirmText: 'ठीक आहे',
        onConfirm,
      });
    },
    [showAlert]
  );

  const showError = useCallback(
    (title: string, message: string | React.ReactNode, onConfirm?: () => void) => {
      showAlert({
        type: 'error',
        title,
        message,
        confirmText: 'समजले',
        onConfirm,
      });
    },
    [showAlert]
  );

  const showConfirm = useCallback(
    (
      title: string,
      message: string | React.ReactNode,
      onConfirm: () => void,
      onCancel?: () => void
    ) => {
      setModalState({
        isOpen: true,
        type: 'confirm',
        title,
        message,
        confirmText: 'पुष्टी करा',
        cancelText: 'रद्द करा',
        showCancel: true,
        onConfirm: () => {
          onConfirm();
          setModalState((prev) => ({ ...prev, isOpen: false }));
        },
        onCancel,
      });
    },
    []
  );

  return (
    <AlertModalContext.Provider
      value={{ showAlert, showSuccess, showError, showConfirm, closeAlert }}
    >
      {children}
      <CenteredAlertModal
        isOpen={modalState.isOpen}
        type={modalState.type}
        title={modalState.title}
        message={modalState.message}
        confirmText={modalState.confirmText}
        cancelText={modalState.cancelText}
        showCancel={modalState.showCancel}
        onConfirm={modalState.onConfirm}
        onClose={closeAlert}
      />
    </AlertModalContext.Provider>
  );
};

export const useAlertModal = (): AlertModalContextType => {
  const context = useContext(AlertModalContext);
  if (!context) {
    throw new Error('useAlertModal must be used within an AlertModalProvider');
  }
  return context;
};
