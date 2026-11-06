import { create } from 'zustand';

type Store = {
  openDialog: (() => void) | null;
  setOpenDialog: (open: (() => void) | null) => void;
};

/**
 * Lets `insert.link` (a host app's menu, outside the editor tree) open the
 * link dialog that MobileToolbar owns and ⌘K toggles. The toolbar registers
 * the opener while mounted, so a request with no toolbar does nothing.
 */
export const useLinkDialogStore = create<Store>()((set) => ({
  openDialog: null,
  setOpenDialog: (openDialog) => set({ openDialog }),
}));

export const openLinkDialog = () =>
  useLinkDialogStore.getState().openDialog?.();
