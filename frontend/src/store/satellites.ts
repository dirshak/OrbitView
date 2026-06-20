import { create } from "zustand";
import type { SatelliteCategory } from "../types/satellite";

interface UserLocation {
  latitudeDeg: number;
  longitudeDeg: number;
  label: string;
}

interface UiState {
  selectedNoradId: number | null;
  query: string;
  activeCategories: Set<SatelliteCategory | "all">;
  favorites: Set<number>;
  showOrbitTrail: boolean;
  showLabels: boolean;
  userLocation: UserLocation | null;

  selectSatellite: (id: number | null) => void;
  setQuery: (q: string) => void;
  toggleCategory: (c: SatelliteCategory | "all") => void;
  toggleFavorite: (id: number) => void;
  setShowOrbitTrail: (v: boolean) => void;
  setShowLabels: (v: boolean) => void;
  setUserLocation: (l: UserLocation | null) => void;
}

const FAVORITES_KEY = "astrotrack:favorites:v1";
const LOCATION_KEY = "astrotrack:location:v1";

function loadFavorites(): Set<number> {
  try {
    const raw = localStorage.getItem(FAVORITES_KEY);
    if (!raw) return new Set();
    const arr = JSON.parse(raw) as number[];
    return new Set(arr.filter((n) => Number.isFinite(n)));
  } catch {
    return new Set();
  }
}

function persistFavorites(s: Set<number>): void {
  try {
    localStorage.setItem(FAVORITES_KEY, JSON.stringify([...s]));
  } catch {
    // ignore quota errors
  }
}

function loadLocation(): UserLocation | null {
  try {
    const raw = localStorage.getItem(LOCATION_KEY);
    return raw ? (JSON.parse(raw) as UserLocation) : null;
  } catch {
    return null;
  }
}

function persistLocation(l: UserLocation | null): void {
  try {
    if (l) localStorage.setItem(LOCATION_KEY, JSON.stringify(l));
    else localStorage.removeItem(LOCATION_KEY);
  } catch {
    // ignore
  }
}

export const useUiStore = create<UiState>((set, get) => ({
  selectedNoradId: null,
  query: "",
  activeCategories: new Set(["all"]),
  favorites: loadFavorites(),
  showOrbitTrail: true,
  showLabels: true,
  userLocation: loadLocation(),

  selectSatellite: (id) => set({ selectedNoradId: id }),
  setQuery: (q) => set({ query: q }),

  toggleCategory: (c) => {
    const cur = new Set(get().activeCategories);
    if (c === "all") {
      set({ activeCategories: new Set(["all"]) });
      return;
    }
    cur.delete("all");
    if (cur.has(c)) cur.delete(c);
    else cur.add(c);
    if (cur.size === 0) cur.add("all");
    set({ activeCategories: cur });
  },

  toggleFavorite: (id) => {
    const cur = new Set(get().favorites);
    if (cur.has(id)) cur.delete(id);
    else cur.add(id);
    persistFavorites(cur);
    set({ favorites: cur });
  },

  setShowOrbitTrail: (v) => set({ showOrbitTrail: v }),
  setShowLabels: (v) => set({ showLabels: v }),

  setUserLocation: (l) => {
    persistLocation(l);
    set({ userLocation: l });
  },
}));
