import { create } from 'zustand';

type StoreActions = {
  setSearchTerm: (val: string) => void;
  setReplaceTerm: (val: string) => void;
  setShowReplacePopover: (val: boolean) => void;
  setShowReplace: (val: boolean) => void;
  toggleShowReplacePopover: () => void;
  toggleShowReplace: () => void;
};
type Store = {
  showSearchReplacePopover: boolean;
  showReplace: boolean;
  searchTerm: string;
  replaceTerm: string;
  actions: StoreActions;
};

export const useSearchReplaceStore = create<Store>()((set) => ({
  showSearchReplacePopover: false,
  showReplace: false,
  searchTerm: '',
  replaceTerm: '',
  actions: {
    setSearchTerm: (val) => set({ searchTerm: val }),
    setReplaceTerm: (val) => set({ replaceTerm: val }),
    setShowReplacePopover: (val) =>
      set({
        showSearchReplacePopover: val,
      }),
    setShowReplace: (val) =>
      set({
        showReplace: val,
      }),
    toggleShowReplacePopover: () =>
      set((state) => ({
        showSearchReplacePopover: !state.showSearchReplacePopover,
      })),
    toggleShowReplace: () =>
      set((state) => ({
        showReplace: !state.showReplace,
      })),
  },
}));
