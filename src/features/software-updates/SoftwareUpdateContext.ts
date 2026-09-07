import { createContext, useContext } from "react";

import type {
  SoftwareUpdateCheckTrigger,
  SoftwareUpdatePreferences,
  SoftwareUpdateStatus,
} from "../../shared/api/softwareUpdates";

export interface SoftwareUpdateContextValue {
  status: SoftwareUpdateStatus | null;
  preferences: SoftwareUpdatePreferences | null;
  loading: boolean;
  actionError: unknown;
  check: (trigger?: SoftwareUpdateCheckTrigger) => Promise<void>;
  setAutoCheck: (enabled: boolean) => Promise<void>;
  downloadAndInstall: () => Promise<void>;
  cancel: () => Promise<void>;
  restart: () => Promise<void>;
  clearActionError: () => void;
}

export const SoftwareUpdateContext = createContext<SoftwareUpdateContextValue | null>(null);

export function useSoftwareUpdate() {
  const context = useContext(SoftwareUpdateContext);
  if (!context) throw new Error("SoftwareUpdateProvider is missing");
  return context;
}
