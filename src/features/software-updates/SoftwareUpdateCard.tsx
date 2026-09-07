import { useState } from "react";

import { describeError } from "../../shared/formatting/errors";
import type { SoftwareUpdateLastCheck } from "../../shared/api/softwareUpdates";
import { useSoftwareUpdate } from "./SoftwareUpdateContext";

const BUSY_PHASES = ["CHECKING", "DOWNLOADING", "VERIFYING", "INSTALLING"] as const;

export function SoftwareUpdateCard() {
  const {
    status,
    preferences,
    loading,
    actionError,
    check,
    setAutoCheck,
    downloadAndInstall,
    cancel,
    restart,
    clearActionError,
  } = useSoftwareUpdate();
  const [confirmInstall, setConfirmInstall] = useState(false);
  const phase = status?.phase ?? "IDLE";
  const busy = BUSY_PHASES.some((candidate) => candidate === phase);
  const release = status?.release;
  const lastCheckText = formatLastCheck(status?.last_check ?? null);

  return (
    <section className="settings-card software-update-card" id="software-update">
      <div className="settings-card-heading software-update-heading">
        <div>
          <p className="section-label">Software Update</p>
          <h2>软件更新</h2>
        </div>
        <button
          className="button button-secondary"
          disabled={loading || busy || phase === "READY_TO_RESTART"}
          onClick={() => {
            clearActionError();
            void check("MANUAL");
          }}
          type="button"
        >
          {phase === "CHECKING" ? "正在检查…" : "立即检查更新"}
        </button>
      </div>

      <div className="software-update-summary">
        <div><span>当前版本</span><strong>{status?.current_version ?? "读取中…"}</strong></div>
        <div><span>上次检查</span><strong>{lastCheckText}</strong></div>
      </div>

      <label className="settings-switch software-update-switch">
        <span className="settings-switch-copy">
          <strong>启动后自动检查</strong>
          <small>后台检查稳定版；离线或超时不会阻塞 Aplena 启动</small>
        </span>
        <input
          aria-label="启动后自动检查软件更新"
          checked={preferences?.auto_check_updates ?? true}
          disabled={!preferences || loading}
          onChange={(event) => void setAutoCheck(event.target.checked)}
          role="switch"
          type="checkbox"
        />
        <span aria-hidden="true" className="settings-switch-track"><span /></span>
      </label>

      {status?.last_check?.trigger === "MANUAL" && status.last_check.outcome === "UP_TO_DATE" && (
        <div className="inline-success" role="status">当前已是最新版本。</div>
      )}

      {release && (
        <div className="software-update-release">
          <div className="software-update-release-title">
            <div><span>可用版本</span><strong>{release.version}</strong></div>
            <small>{formatBytes(release.download_size_bytes)}</small>
          </div>
          <div className="software-update-notes">
            <strong>更新说明</strong>
            <p>{release.notes?.trim() || "此版本未提供更新说明。"}</p>
          </div>
        </div>
      )}

      {(phase === "DOWNLOADING" || phase === "VERIFYING" || phase === "INSTALLING") && (
        <div className="software-update-progress" aria-live="polite">
          <div>
            <strong>{phaseLabel(phase)}</strong>
            <span>{formatProgress(status)}</span>
          </div>
          <progress
            aria-label="软件下载进度"
            max={status?.total_bytes ?? undefined}
            value={status?.total_bytes ? status.downloaded_bytes : undefined}
          />
          {phase === "DOWNLOADING" && (
            <button className="text-button" onClick={() => void cancel()} type="button">取消下载</button>
          )}
        </div>
      )}

      {release && phase === "AVAILABLE" && !confirmInstall && (
        <button
          className="button button-primary"
          disabled={!status.update_signing_ready}
          onClick={() => setConfirmInstall(true)}
          type="button"
        >
          下载并安装
        </button>
      )}
      {release && phase === "AVAILABLE" && confirmInstall && (
        <div className="software-update-confirm" role="group" aria-label="确认安装更新">
          <p>安装完成后仍由你决定何时重启。开始前请先保存正在编辑的内容。</p>
          <div>
            <button className="button button-quiet" onClick={() => setConfirmInstall(false)} type="button">取消</button>
            <button
              className="button button-primary"
              onClick={() => {
                setConfirmInstall(false);
                void downloadAndInstall();
              }}
              type="button"
            >
              确认下载并安装
            </button>
          </div>
        </div>
      )}
      {phase === "READY_TO_RESTART" && (
        <button className="button button-primary" onClick={() => void restart()} type="button">保存完成，立即重启</button>
      )}

      {status && !status.update_signing_ready && (
        <div className="inline-warning" role="status">
          当前构建未嵌入生产 updater 公钥，因此不会安装下载包。正式发行前必须配置独立更新签名密钥。
        </div>
      )}
      {actionError !== null && <div className="inline-error" role="alert">{describeError(actionError)}</div>}
    </section>
  );
}

function phaseLabel(phase: "DOWNLOADING" | "VERIFYING" | "INSTALLING") {
  if (phase === "DOWNLOADING") return "正在下载更新";
  if (phase === "VERIFYING") return "正在验证更新签名";
  return "正在安全替换应用";
}

function formatProgress(status: ReturnType<typeof useSoftwareUpdate>["status"]) {
  if (!status) return "";
  if (!status.total_bytes) return formatBytes(status.downloaded_bytes);
  const percent = Math.min(100, Math.round((status.downloaded_bytes / status.total_bytes) * 100));
  return `${percent}% · ${formatBytes(status.downloaded_bytes)} / ${formatBytes(status.total_bytes)}`;
}

function formatBytes(value: number | null | undefined) {
  if (value === null || value === undefined) return "大小将在下载时确定";
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

function formatLastCheck(lastCheck: SoftwareUpdateLastCheck | null) {
  if (!lastCheck) return "尚未检查";
  const outcome = {
    UP_TO_DATE: "已是最新",
    UPDATE_AVAILABLE: "发现更新",
    FAILED: "检查失败",
  }[lastCheck.outcome];
  const date = new Date(lastCheck.completed_at);
  const timestamp = Number.isNaN(date.getTime()) ? lastCheck.completed_at : date.toLocaleString("zh-CN");
  return `${outcome} · ${timestamp}`;
}
