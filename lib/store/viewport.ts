import { createStore } from 'zustand/vanilla';

interface ViewportState {
  readonly scrollLeft: number;
  readonly scrollTop: number;
  readonly zoom: number;
  readonly currentPage: number;
  readonly currentPageRevision: number;
  readonly activatedOutlinePath: string | null;
  readonly activatedOutlinePage: number | null;
  setScroll(left: number, top: number): void;
  setZoom(zoom: number): void;
  setCurrentPage(pageIndex: number): void;
  activateOutline(path: string, pageIndex: number): void;
  reset(): void;
}

export const viewportStore = createStore<ViewportState>((set) => ({
  scrollLeft: 0,
  scrollTop: 0,
  zoom: 1,
  currentPage: 0,
  currentPageRevision: 0,
  activatedOutlinePath: null,
  activatedOutlinePage: null,
  setScroll: (scrollLeft, scrollTop) => set({ scrollLeft, scrollTop }),
  setZoom: (zoom) => set({ zoom }),
  setCurrentPage: (currentPage) =>
    set((state) => {
      const currentPageRevision =
        currentPage === state.currentPage
          ? state.currentPageRevision
          : state.currentPageRevision + 1;
      if (state.activatedOutlinePage === null) return { currentPage, currentPageRevision };
      if (currentPage === state.activatedOutlinePage)
        return { currentPage, currentPageRevision };
      return {
        currentPage,
        currentPageRevision,
        activatedOutlinePath: null,
        activatedOutlinePage: null,
      };
    }),
  activateOutline: (activatedOutlinePath, activatedOutlinePage) =>
    set({
      activatedOutlinePath,
      activatedOutlinePage,
    }),
  reset: () =>
    set({
      scrollLeft: 0,
      scrollTop: 0,
      zoom: 1,
      currentPage: 0,
      currentPageRevision: 0,
      activatedOutlinePath: null,
      activatedOutlinePage: null,
    }),
}));

export default viewportStore;
