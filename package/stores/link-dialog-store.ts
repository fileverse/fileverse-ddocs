import { create } from 'zustand';

type Store = {
  isLinkDialogRequested: boolean;
  setLinkDialogRequested: (val: boolean) => void;
};

/**
 * Lets `insert.link` (a host app's menu, outside the editor tree) open the
 * link dialog that MobileToolbar owns and ⌘K toggles. MobileToolbar clears the
 * flag once it has opened the dialog.
 */
export const useLinkDialogStore = create<Store>()((set) => ({
  isLinkDialogRequested: false,
  setLinkDialogRequested: (val) => set({ isLinkDialogRequested: val }),
}));

export const openLinkDialog = () =>
  useLinkDialogStore.getState().setLinkDialogRequested(true);
