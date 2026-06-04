import { useCallback } from 'react';

export function useToast() {
  const showToast = useCallback((type, message) => {
    // Create toast container if it doesn't exist
    let container = document.getElementById('global-toast-container');
    if (!container) {
      container = document.createElement('div');
      container.id = 'global-toast-container';
      container.style.position = 'fixed';
      container.style.top = '24px';
      container.style.right = '24px';
      container.style.zIndex = '99999';
      container.style.display = 'flex';
      container.style.flexDirection = 'column';
      container.style.gap = '12px';
      document.body.appendChild(container);
    }

    // Create toast element
    const toastEl = document.createElement('div');
    toastEl.style.padding = '14px 24px';
    toastEl.style.borderRadius = '12px';
    toastEl.style.color = '#ffffff';
    toastEl.style.fontWeight = '600';
    toastEl.style.fontSize = '14px';
    toastEl.style.boxShadow = '0 10px 25px -5px rgba(0,0,0,0.15), 0 8px 10px -6px rgba(0,0,0,0.15)';
    toastEl.style.display = 'flex';
    toastEl.style.alignItems = 'center';
    toastEl.style.gap = '10px';
    toastEl.style.transition = 'all 0.4s cubic-bezier(0.16, 1, 0.3, 1)';
    toastEl.style.opacity = '0';
    toastEl.style.transform = 'translateY(-20px) scale(0.95)';
    toastEl.style.backdropFilter = 'blur(8px)';

    if (type === 'success') {
      toastEl.style.background = 'linear-gradient(135deg, #10b981, #059669)'; // Emerald
    } else if (type === 'error') {
      toastEl.style.background = 'linear-gradient(135deg, #ef4444, #dc2626)'; // Red
    } else {
      toastEl.style.background = 'linear-gradient(135deg, #3b82f6, #2563eb)'; // Blue
    }

    toastEl.innerText = message;
    container.appendChild(toastEl);

    // Animate in
    setTimeout(() => {
      toastEl.style.opacity = '1';
      toastEl.style.transform = 'translateY(0) scale(1)';
    }, 10);

    // Animate out and remove
    setTimeout(() => {
      toastEl.style.opacity = '0';
      toastEl.style.transform = 'translateY(-15px) scale(0.95)';
      setTimeout(() => {
        toastEl.remove();
      }, 400);
    }, 3500);
  }, []);

  const toast = {
    success: useCallback((msg) => showToast('success', msg), [showToast]),
    error: useCallback((msg) => showToast('error', msg), [showToast]),
    info: useCallback((msg) => showToast('info', msg), [showToast]),
  };

  return { toast };
}
