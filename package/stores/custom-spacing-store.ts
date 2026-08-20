import { create } from 'zustand';

type Store = {
  isCustomSpacingOpen: boolean;
  setCustomSpacingOpen: (val: boolean) => void;
};

/**
 * Open/closed state for the one CustomSpacingDialog, which ddoc-editor mounts.
 * Module-level like search-replace-store: the entry points are scattered (the
 * toolbar dropdown, the bubble menu, and a host app's own menu rendered
 * outside the editor tree), so they share a flag rather than each owning a
 * dialog instance.
 */
export const useCustomSpacingStore = create<Store>()((set) => ({
  isCustomSpacingOpen: false,
  setCustomSpacingOpen: (val) => set({ isCustomSpacingOpen: val }),
}));

export const openCustomSpacingDialog = () =>
  useCustomSpacingStore.getState().setCustomSpacingOpen(true);
