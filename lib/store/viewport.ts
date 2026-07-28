import { createStore } from 'zustand/vanilla';

interface ViewportState {
  readonly scrollLeft: number;
  readonly scrollTop: number;
  readonly zoom: number;
  readonly currentPage: number;
  setScroll(left: number, top: number): void;
  setZoom(zoom: number): void;
  setCurrentPage(pageIndex: number): void;
  reset(): void;
}

export const viewportStore = createStore<ViewportState>((set) => ({
  scrollLeft: 0,
  scrollTop: 0,
  zoom: 1,
  currentPage: 0,
  setScroll: (scrollLeft, scrollTop) => set({ scrollLeft, scrollTop }),
  setZoom: (zoom) => set({ zoom }),
  setCurrentPage: (currentPage) => set({ currentPage }),
  reset: () => set({ scrollLeft: 0, scrollTop: 0, zoom: 1, currentPage: 0 }),
}));

export default viewportStore;
