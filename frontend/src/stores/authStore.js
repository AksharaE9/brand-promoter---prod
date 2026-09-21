import { create } from './zustand';

const getStoredToken = () => (typeof localStorage !== 'undefined' ? localStorage.getItem('ats_token') : null);
const getStoredUser = () => {
  if (typeof localStorage === 'undefined') return null;
  const raw = localStorage.getItem('ats_user');
  if (!raw) return null;
  try { return JSON.parse(raw); } catch (_) { return null; }
};

export const useAuthStore = create((set) => ({
  accessToken: getStoredToken(),
  user: getStoredUser(),
  isAuthenticated: Boolean(getStoredToken()),
  isVerified: false,
  
  setAuth(token, user) {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem('ats_token', token);
      localStorage.setItem('ats_user', JSON.stringify(user));
    }
    set({ accessToken: token, user, isAuthenticated: true, isVerified: true });
  },
  
  clearAuth() {
    if (typeof localStorage !== 'undefined') {
      localStorage.removeItem('ats_token');
      localStorage.removeItem('ats_user');
    }
    set({ accessToken: null, user: null, isAuthenticated: false, isVerified: false });
  },

  setVerified(verified) {
    set({ isVerified: verified });
  }
}));

// Synchronize state across tabs/windows
if (typeof window !== 'undefined') {
  window.addEventListener('storage', (event) => {
    if (event.key === 'ats_token') {
      const token = event.newValue;
      const user = getStoredUser();
      useAuthStore.setState({
        accessToken: token,
        user,
        isAuthenticated: Boolean(token),
      });
    }
  });
}
