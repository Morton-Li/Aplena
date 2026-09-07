import { invoke } from "@tauri-apps/api/core";

import type { AppError, Invoke } from "./domain";

export type SoftwareUpdatePhase =
  | "IDLE"
  | "CHECKING"
  | "AVAILABLE"
  | "DOWNLOADING"
  | "VERIFYING"
  | "INSTALLING"
  | "READY_TO_RESTART";

export type SoftwareUpdateCheckTrigger = "STARTUP" | "MANUAL";
export type SoftwareUpdateCheckOutcome = "UP_TO_DATE" | "UPDATE_AVAILABLE" | "FAILED";

export interface SoftwareUpdateRelease {
  version: string;
  notes: string | null;
  published_at: string | null;
  download_size_bytes: number | null;
}

export interface SoftwareUpdateLastCheck {
  completed_at: string;
  trigger: SoftwareUpdateCheckTrigger | null;
  outcome: SoftwareUpdateCheckOutcome;
}

export interface SoftwareUpdateStatus {
  current_version: string;
  phase: SoftwareUpdatePhase;
  release: SoftwareUpdateRelease | null;
  downloaded_bytes: number;
  total_bytes: number | null;
  last_check: SoftwareUpdateLastCheck | null;
  last_error: AppError | null;
  update_signing_ready: boolean;
}

export interface SoftwareUpdatePreferences {
  auto_check_updates: boolean;
}

export const SOFTWARE_UPDATE_STATUS_EVENT = "software-update://status";

export function getSoftwareUpdatePreferences(
  invokeCommand: Invoke = invoke,
): Promise<SoftwareUpdatePreferences> {
  return invokeCommand<SoftwareUpdatePreferences>("get_software_update_preferences");
}

export function setSoftwareUpdateAutoCheck(
  enabled: boolean,
  invokeCommand: Invoke = invoke,
): Promise<SoftwareUpdatePreferences> {
  return invokeCommand<SoftwareUpdatePreferences>("set_software_update_auto_check", {
    input: { enabled },
  });
}

export function getSoftwareUpdateStatus(
  invokeCommand: Invoke = invoke,
): Promise<SoftwareUpdateStatus> {
  return invokeCommand<SoftwareUpdateStatus>("get_software_update_status");
}

export function checkSoftwareUpdate(
  trigger: SoftwareUpdateCheckTrigger,
  invokeCommand: Invoke = invoke,
): Promise<SoftwareUpdateStatus> {
  return invokeCommand<SoftwareUpdateStatus>("check_software_update", { trigger });
}

export function downloadAndInstallSoftwareUpdate(
  invokeCommand: Invoke = invoke,
): Promise<SoftwareUpdateStatus> {
  return invokeCommand<SoftwareUpdateStatus>("download_and_install_software_update");
}

export function cancelSoftwareUpdate(
  invokeCommand: Invoke = invoke,
): Promise<SoftwareUpdateStatus> {
  return invokeCommand<SoftwareUpdateStatus>("cancel_software_update");
}

export function restartAfterSoftwareUpdate(invokeCommand: Invoke = invoke): Promise<void> {
  return invokeCommand<void>("restart_after_software_update");
}
