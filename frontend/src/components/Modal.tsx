import type { ReactNode } from 'react';
import { useEffect } from 'react';

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  size?: 'sm' | 'md' | 'lg' | 'xl';
}

export function Modal({ isOpen, onClose, title, children, size = 'md' }: ModalProps) {
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => {
      document.body.style.overflow = '';
    };
  }, [isOpen]);

  if (!isOpen) return null;

  const sizeClasses = {
    sm: 'max-w-sm',
    md: 'max-w-md',
    lg: 'max-w-lg',
    xl: 'max-w-2xl',
  };

  return (
    <>
      {/* Backdrop - covers full screen */}
      <div
        className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50"
        onClick={onClose}
      />
      
      {/* Modal container - offset by sidebar and topbar */}
      <div 
        className="fixed inset-0 z-50 overflow-y-auto pointer-events-none pl-48 pt-[4.5rem] pb-4"
        onClick={onClose}
      >
        <div className="flex min-h-[calc(100vh-4.5rem-1rem)] items-start justify-center p-4 pointer-events-none">
          <div
            className={`relative w-full ${sizeClasses[size]} vault-panel shadow-vault-outer border-2 border-dark-700 max-h-[calc(100vh-4.5rem-1rem-2rem)] flex flex-col pointer-events-auto`}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header - Fixed */}
            <div className="flex items-center justify-between p-3 border-b-2 border-dark-700 relative flex-shrink-0">
              <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-primary-600/50 to-transparent"></div>
              <h2 className="text-sm font-display font-bold text-gradient-red vault-text-glow">{title}</h2>
              <button
                onClick={onClose}
                className="text-dark-500 hover:text-primary-400 transition-colors p-1 rounded hover:bg-vault-dark-4"
                aria-label="Close"
              >
                <svg
                  className="w-5 h-5"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M6 18L18 6M6 6l12 12"
                  />
                </svg>
              </button>
            </div>

            {/* Content - Scrollable */}
            <div className="p-3 overflow-y-auto flex-1 min-h-0">
              {children}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
