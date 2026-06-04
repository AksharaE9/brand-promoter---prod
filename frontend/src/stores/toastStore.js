import { create } from './zustand';

let _id = 0;
const DURATION = 4000;

export const useToastStore = create((set) => ({
  toasts: [],
  addToast({ type = 'info', message, duration = DURATION }) {
    const id = ++_id;
    set(s => ({ toasts: [...s.toasts, { id, type, message }] }));
    setTimeout(() => set(s => ({ toasts: s.toasts.filter(t => t.id !== id) })), duration);
  },
  removeToast(id) {
    set(s => ({ toasts: s.toasts.filter(t => t.id !== id) }));
  },
}));
