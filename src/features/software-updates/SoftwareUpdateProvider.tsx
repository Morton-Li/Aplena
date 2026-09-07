import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { NavLink } from "react-router-dom";

import { Dialog } from "../../shared/components/Dialog";
import {
  SOFTWARE_UPDATE_STATUS_EVENT,
  cancelSoftwareUpdate,
  checkSoftwareUpdate,
  downloadAndInstallSoftwareUpdate,
  getSoftwareUpdatePreferences,
  getSoftwareUpdateStatus,
  restartAfterSoftwareUpdate,
  setSoftwareUpdateAutoCheck,
  type SoftwareUpdateCheckTrigger,
  type SoftwareUpdatePreferences,
  type SoftwareUpdateStatus,
} from "../../shared/api/softwareUpdates";
import {
  SoftwareUpdateContext,
  type SoftwareUpdateContextValue,
  useSoftwareUpdate,
} from "./SoftwareUpdateContext";

export function SoftwareUpdateProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<SoftwareUpdateStatus | null>(null);
  const [preferences, setPreferences] = useState<SoftwareUpdatePreferences | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionError, setActionError] = useState<unknown>(null);
  const startupCheckAttempted = useRef(false);

  const refreshStatus = useCallback(async () => {
    const next = await getSoftwareUpdateStatus();
    setStatus(next);
    return next;
  }, []);

  const check = useCallback(
    async (trigger: SoftwareUpdateCheckTrigger = "MANUAL") => {
      if (trigger === "MANUAL") setActionError(null);
      try {
        setStatus(await checkSoftwareUpdate(trigger));
      } catch (error) {
        if (trigger === "MANUAL") setActionError(error);
        await refreshStatus().catch(() => undefined);
      }
    },
    [refreshStatus],
  );

  useEffect(() => {
    let disposed = false;
    let unlisten: UnlistenFn | undefined;

    void (async () => {
      try {
        const stopListening = await listen<SoftwareUpdateStatus>(SOFTWARE_UPDATE_STATUS_EVENT, (event) => {
          if (!disposed) setStatus(event.payload);
        });
        if (disposed) {
          stopListening();
          return;
        }
        unlisten = stopListening;
        const [nextPreferences, nextStatus] = await Promise.all([
          getSoftwareUpdatePreferences(),
          getSoftwareUpdateStatus(),
        ]);
        if (disposed) return;
        setPreferences(nextPreferences);
        setStatus(nextStatus);
        setLoading(false);
        if (nextPreferences.auto_check_updates && !startupCheckAttempted.current) {
          startupCheckAttempted.current = true;
          await check("STARTUP");
        }
      } catch (error) {
        if (!disposed) {
          setLoading(false);
          setActionError(error);
        }
      }
    })();

    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [check]);

  const value = useMemo<SoftwareUpdateContextValue>(
    () => ({
      status,
      preferences,
      loading,
      actionError,
      check,
      setAutoCheck: async (enabled) => {
        setActionError(null);
        try {
          setPreferences(await setSoftwareUpdateAutoCheck(enabled));
        } catch (error) {
          setActionError(error);
        }
      },
      downloadAndInstall: async () => {
        setActionError(null);
        try {
          setStatus(await downloadAndInstallSoftwareUpdate());
        } catch (error) {
          setActionError(error);
          await refreshStatus().catch(() => undefined);
        }
      },
      cancel: async () => {
        setActionError(null);
        try {
          setStatus(await cancelSoftwareUpdate());
        } catch (error) {
          setActionError(error);
          await refreshStatus().catch(() => undefined);
        }
      },
      restart: async () => {
        setActionError(null);
        try {
          await restartAfterSoftwareUpdate();
        } catch (error) {
          setActionError(error);
        }
      },
      clearActionError: () => setActionError(null),
    }),
    [actionError, check, loading, preferences, refreshStatus, status],
  );

  return <SoftwareUpdateContext.Provider value={value}>{children}</SoftwareUpdateContext.Provider>;
}

export function SoftwareUpdateBanner() {
  const { status } = useSoftwareUpdate();
  if (!status?.release || !["AVAILABLE", "READY_TO_RESTART"].includes(status.phase)) return null;

  return (
    <aside className="software-update-banner" aria-live="polite">
      <span>
        {status.phase === "READY_TO_RESTART"
          ? `Aplena ${status.release.version} 已安装，重启后生效。`
          : `Aplena ${status.release.version} 已可用。`}
      </span>
      <NavLink className="text-button" to="/settings#software-update">
        {status.phase === "READY_TO_RESTART" ? "完成重启" : "查看更新"}
      </NavLink>
    </aside>
  );
}

export function SoftwareUpdateRestartDialog() {
  const { status, restart } = useSoftwareUpdate();
  const [dismissedVersion, setDismissedVersion] = useState<string | null>(null);
  const version = status?.phase === "READY_TO_RESTART" ? status.release?.version ?? null : null;
  const open = version !== null && version !== dismissedVersion;

  if (!open || !version) return null;
  return (
    <Dialog
      className="software-update-restart-dialog"
      eyebrow="Update Ready"
      footer={
        <>
          <button
            className="button button-quiet"
            data-dialog-initial-focus
            onClick={() => setDismissedVersion(version)}
            type="button"
          >
            稍后
          </button>
          <button className="button button-primary" onClick={() => void restart()} type="button">
            立即重启
          </button>
        </>
      }
      onClose={() => setDismissedVersion(version)}
      title="更新已安装"
    >
      <p id="software-update-restart-description">
          Aplena {version} 将在重启后生效。请先保存正在编辑的内容；Aplena 不会替你自动重启。
      </p>
    </Dialog>
  );
}
