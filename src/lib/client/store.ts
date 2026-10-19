"use client";
import { useSyncExternalStore } from "react";
import { Store } from "@/lib/sync/store";
import { LOCAL_ONLY, VERSIONED } from "@/lib/game/progress";

let store: Store | null = null;
/** The one store for this tab: cached in localStorage, synced when signed in. */
export function getStore(): Store {
  return (store ??= new Store({ storage: window.localStorage, storageKey: "jh-store-v1", versioned: VERSIONED, localOnly: LOCAL_ONLY }));
}
/** Re-render whenever any row changes (here or on another device). */
export function useStoreRev(s: Store) {
  return useSyncExternalStore(s.subscribe, s.getRev, () => 0);
}
