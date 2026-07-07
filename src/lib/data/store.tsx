"use client";

/**
 * Client-side store for v1: holds the base forecast input and saved scenarios,
 * persisted to localStorage. This is the seam where a Supabase-backed data
 * layer drops in later — the components only ever touch `useStore`.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import type { ForecastInput, Scenario } from "@engine/index.js";
import { SEED_INPUT, SEED_SCENARIOS } from "./seed.js";

const STORAGE_KEY = "brains-cashflow-v1";

interface AppState {
  input: ForecastInput;
  scenarios: Scenario[];
}

interface Store extends AppState {
  ready: boolean;
  setInput: (updater: (prev: ForecastInput) => ForecastInput) => void;
  setScenarios: (updater: (prev: Scenario[]) => Scenario[]) => void;
  reset: () => void;
}

const StoreContext = createContext<Store | null>(null);

function initialState(): AppState {
  return { input: SEED_INPUT, scenarios: SEED_SCENARIOS };
}

export function StoreProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AppState>(initialState);
  const [ready, setReady] = useState(false);

  // Load persisted state after mount (avoids SSR/localStorage mismatch).
  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as Partial<AppState>;
        if (parsed.input) {
          setState({ input: parsed.input, scenarios: parsed.scenarios ?? [] });
        }
      }
    } catch {
      // ignore corrupt storage — fall back to seed
    }
    setReady(true);
  }, []);

  // Persist on change once we've loaded.
  useEffect(() => {
    if (!ready) return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
      // storage full / unavailable — non-fatal
    }
  }, [state, ready]);

  const setInput = useCallback(
    (updater: (prev: ForecastInput) => ForecastInput) =>
      setState((s) => ({ ...s, input: updater(s.input) })),
    [],
  );
  const setScenarios = useCallback(
    (updater: (prev: Scenario[]) => Scenario[]) =>
      setState((s) => ({ ...s, scenarios: updater(s.scenarios) })),
    [],
  );
  const reset = useCallback(() => setState(initialState()), []);

  return (
    <StoreContext.Provider value={{ ...state, ready, setInput, setScenarios, reset }}>
      {children}
    </StoreContext.Provider>
  );
}

export function useStore(): Store {
  const ctx = useContext(StoreContext);
  if (!ctx) throw new Error("useStore must be used within <StoreProvider>");
  return ctx;
}
