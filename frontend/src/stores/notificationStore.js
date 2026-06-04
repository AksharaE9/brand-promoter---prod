import { create } from './zustand';

export const useNotificationStore = create((set) => ({
  notifications: [],
  unreadCount: 0,
  addNotification(notification) {
    set(s => ({
      notifications: [notification, ...s.notifications],
    }));
  },
  incrementUnread() {
    set(s => ({
      unreadCount: s.unreadCount + 1,
    }));
  },
  setUnreadCount(count) {
    set({ unreadCount: count });
  },
  setNotifications(notifications) {
    set({ notifications });
  }
}));
