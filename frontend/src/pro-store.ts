/**
 * Global, synchronous in-memory `isPro` store.
 *
 * Why a hand-rolled subject rather than React state?
 *   - The previous implementation read `is_pro` from a per-screen `scanInfo`
 *     state that got reloaded on every tab focus. Any time the user saved
 *     a card or deleted one, the refocus fetch put scan.tsx into a brief
 *     "is_pro = undefined → falsy → paywall" window before the network
 *     response landed. The user saw the paywall flicker for 100-500ms.
 *   - This store keeps the Pro flag as a plain in-memory boolean that
 *     never resets to a falsy intermediate. It is hydrated ONCE at boot
 *     from AsyncStorage + RevenueCat + the backend scan counter, then
 *     only changes when a real upgrade happens (paywall confirm).
 *
 * Contract:
 *   - Save / delete card flows MUST NOT touch this store.
 *   - The scanner gate reads `proStore.get()` synchronously — no awaits,
 *     no useEffects, no network round-trips.
 *   - `setPro(true)` is idempotent and persists to AsyncStorage.
 */

import { useEffect, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

const KEY = 'pv.isPro.v1';

type Listener = (v: boolean) => void;

let _isPro = false;
let _hydrated = false;
const listeners = new Set<Listener>();

function emit() {
  for (const l of listeners) l(_isPro);
}

export const proStore = {
  /** Synchronous read. Safe to call from anywhere, no async. */
  get(): boolean {
    return _isPro;
  },

  hasHydrated(): boolean {
    return _hydrated;
  },

  /**
   * Set the Pro flag. Idempotent: a redundant call does NOT trigger
   * subscribers, preventing render storms.
   *
   * @param persist  When true (default) also writes to AsyncStorage so the
   *                 next cold boot stays Pro before any network call lands.
   */
  setPro(value: boolean, persist: boolean = true): void {
    if (_isPro === value && _hydrated) return;
    _isPro = value;
    _hydrated = true;
    if (persist) {
      AsyncStorage.setItem(KEY, value ? '1' : '0').catch(() => { /* fire-and-forget */ });
    }
    emit();
  },

  /**
   * Hydrate from AsyncStorage on app boot. Safe to call multiple times —
   * it only flips state on the FIRST call.
   */
  async hydrate(): Promise<void> {
    if (_hydrated) return;
    try {
      const raw = await AsyncStorage.getItem(KEY);
      _isPro = raw === '1';
    } catch {
      _isPro = false;
    }
    _hydrated = true;
    emit();
  },

  /** Subscribe to changes. Returns an unsubscribe function. */
  subscribe(l: Listener): () => void {
    listeners.add(l);
    return () => listeners.delete(l);
  },

  /** Reset (used on logout). */
  reset(): void {
    if (_isPro === false && _hydrated) return;
    _isPro = false;
    _hydrated = true;
    AsyncStorage.removeItem(KEY).catch(() => {});
    emit();
  },
};

/**
 * React hook that mirrors the store into component state. The initial value
 * is read synchronously from the module so the first render never sees a
 * "false" flash if the user is already Pro.
 */
export function useIsPro(): boolean {
  const [v, setV] = useState<boolean>(() => proStore.get());
  useEffect(() => proStore.subscribe(setV), []);
  return v;
}
