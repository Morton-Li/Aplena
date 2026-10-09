import { createContext, useContext } from "react";

import type { AutomaticEntryCheck } from "../../shared/api/automatic";

export interface AutomaticEntryContextValue {
  result: AutomaticEntryCheck | null;
  checking: boolean;
  error: unknown;
  check: () => Promise<void>;
}

export const AutomaticEntryContext = createContext<AutomaticEntryContextValue>({
  result: null,
  checking: false,
  error: null,
  check: async () => undefined,
});

export function useAutomaticEntries() {
  return useContext(AutomaticEntryContext);
}
