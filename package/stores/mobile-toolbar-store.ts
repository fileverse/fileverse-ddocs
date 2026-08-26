import { create } from 'zustand';

type Store = {
  isMobileToolbarOpen: boolean;
  setMobileToolbarOpen: (val: boolean) => void;
};

/**
 * Whether one of the mobile toolbar's sheets/modals (text formatting, link)
 * owns the screen. Module-level like custom-spacing-store: the bubble menu is
 * a separate tree and must hide itself while these are open — on native
 * mobile it shows for any in-editor selection, focus or not, and its inline
 * z-index sits above the drawer.
 */
export const useMobileToolbarStore = create<Store>()((set) => ({
  isMobileToolbarOpen: false,
  setMobileToolbarOpen: (val) => set({ isMobileToolbarOpen: val }),
}));
