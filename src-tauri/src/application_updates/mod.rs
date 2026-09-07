mod safe_macos;

use std::{
    collections::BTreeMap,
    sync::{
        Arc,
        atomic::{AtomicBool, AtomicU64, Ordering},
    },
    time::Duration,
};

use base64::{Engine as _, engine::general_purpose::STANDARD};
use minisign_verify::PublicKey;
use semver::Version;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Runtime, State};
use tauri_plugin_updater::{Error as UpdaterError, Update, UpdaterExt};
use tokio::sync::{Mutex, oneshot};
use url::Url;

use crate::infrastructure::Store;

const UPDATE_ENDPOINT: &str =
    "https://github.com/Morton-Li/Aplena/releases/latest/download/latest.json";
const UPDATE_PUBLIC_KEY_PLACEHOLDER: &str = "APLENA_UPDATER_PUBLIC_KEY_REQUIRED";
const UPDATE_CHECK_TIMEOUT: Duration = Duration::from_secs(8);
const UPDATE_DOWNLOAD_TIMEOUT: Duration = Duration::from_secs(10 * 60);
pub(crate) const SOFTWARE_UPDATE_STATUS_EVENT: &str = "software-update://status";

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct SoftwareUpdateError {
    pub error_code: String,
    pub message_key: String,
    #[serde(skip_serializing_if = "BTreeMap::is_empty")]
    pub params: BTreeMap<String, String>,
}

impl SoftwareUpdateError {
    fn new(error_code: &str, message_key: &str) -> Self {
        Self {
            error_code: error_code.to_owned(),
            message_key: message_key.to_owned(),
            params: BTreeMap::new(),
        }
    }

    fn with_version(mut self, version: &str) -> Self {
        self.params.insert("version".to_owned(), version.to_owned());
        self
    }

    fn operation_in_progress() -> Self {
        Self::new(
            "UPDATE_OPERATION_IN_PROGRESS",
            "error.update_operation_in_progress",
        )
    }

    fn preferences_failed() -> Self {
        Self::new(
            "UPDATE_PREFERENCES_FAILED",
            "error.update_preferences_failed",
        )
    }
}

impl std::fmt::Display for SoftwareUpdateError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(&self.error_code)
    }
}

impl std::error::Error for SoftwareUpdateError {}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum UpdateCheckTrigger {
    Startup,
    Manual,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum UpdatePhase {
    Idle,
    Checking,
    Available,
    Downloading,
    Verifying,
    Installing,
    ReadyToRestart,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum UpdateCheckOutcome {
    UpToDate,
    UpdateAvailable,
    Failed,
}

impl UpdateCheckOutcome {
    fn as_persisted(self) -> &'static str {
        match self {
            Self::UpToDate => "UP_TO_DATE",
            Self::UpdateAvailable => "UPDATE_AVAILABLE",
            Self::Failed => "FAILED",
        }
    }

    fn from_persisted(value: &str) -> Option<Self> {
        match value {
            "UP_TO_DATE" => Some(Self::UpToDate),
            "UPDATE_AVAILABLE" => Some(Self::UpdateAvailable),
            "FAILED" => Some(Self::Failed),
            _ => None,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct SoftwareUpdateRelease {
    pub version: String,
    pub notes: Option<String>,
    pub published_at: Option<String>,
    pub download_size_bytes: Option<u64>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct SoftwareUpdateLastCheck {
    pub completed_at: String,
    pub trigger: Option<UpdateCheckTrigger>,
    pub outcome: UpdateCheckOutcome,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct SoftwareUpdateStatus {
    pub current_version: String,
    pub phase: UpdatePhase,
    pub release: Option<SoftwareUpdateRelease>,
    pub downloaded_bytes: u64,
    pub total_bytes: Option<u64>,
    pub last_check: Option<SoftwareUpdateLastCheck>,
    pub last_error: Option<SoftwareUpdateError>,
    pub update_signing_ready: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct SoftwareUpdatePreferences {
    pub auto_check_updates: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SetSoftwareUpdateAutoCheckInput {
    pub enabled: bool,
}

#[derive(Clone)]
struct PendingUpdate {
    update: Update,
    release: SoftwareUpdateRelease,
}

struct TransferState {
    pending: PendingUpdate,
    verifying: Arc<AtomicBool>,
    downloaded_bytes: Arc<AtomicU64>,
    total_bytes: Arc<AtomicU64>,
    cancel: Option<oneshot::Sender<()>>,
}

enum RuntimeState {
    Idle,
    Checking,
    Available(PendingUpdate),
    Transferring(TransferState),
    Installing(PendingUpdate),
    ReadyToRestart(SoftwareUpdateRelease),
}

impl RuntimeState {
    fn is_busy(&self) -> bool {
        matches!(
            self,
            Self::Checking | Self::Transferring(_) | Self::Installing(_)
        )
    }
}

struct RuntimeSnapshot {
    state: RuntimeState,
    last_check: Option<SoftwareUpdateLastCheck>,
    last_error: Option<SoftwareUpdateError>,
}

#[derive(Clone)]
pub struct SoftwareUpdateService {
    store: Store,
    runtime: Arc<Mutex<RuntimeSnapshot>>,
}

impl SoftwareUpdateService {
    pub fn new(store: Store) -> Self {
        Self {
            store,
            runtime: Arc::new(Mutex::new(RuntimeSnapshot {
                state: RuntimeState::Idle,
                last_check: None,
                last_error: None,
            })),
        }
    }

    async fn status(&self, current_version: &str) -> SoftwareUpdateStatus {
        let runtime = self.runtime.lock().await;
        status_from_runtime(current_version, &runtime)
    }

    async fn emit_status<R: Runtime>(&self, app: &AppHandle<R>) {
        let status = self.status(&app.package_info().version.to_string()).await;
        let _ = app.emit(SOFTWARE_UPDATE_STATUS_EVENT, status);
    }

    async fn record_check(
        &self,
        trigger: UpdateCheckTrigger,
        outcome: UpdateCheckOutcome,
    ) -> (SoftwareUpdateLastCheck, Option<SoftwareUpdateError>) {
        let completed_at = chrono::Utc::now().to_rfc3339();
        let persistence_error = self
            .store
            .record_software_update_check(outcome.as_persisted(), &completed_at)
            .await
            .err()
            .map(|_| SoftwareUpdateError::preferences_failed());
        (
            SoftwareUpdateLastCheck {
                completed_at,
                trigger: Some(trigger),
                outcome,
            },
            persistence_error,
        )
    }
}

fn status_from_runtime(current_version: &str, runtime: &RuntimeSnapshot) -> SoftwareUpdateStatus {
    let (phase, release, downloaded_bytes, total_bytes) = match &runtime.state {
        RuntimeState::Idle => (UpdatePhase::Idle, None, 0, None),
        RuntimeState::Checking => (UpdatePhase::Checking, None, 0, None),
        RuntimeState::Available(pending) => (
            UpdatePhase::Available,
            Some(pending.release.clone()),
            0,
            None,
        ),
        RuntimeState::Transferring(transfer) => (
            if transfer.verifying.load(Ordering::Acquire) {
                UpdatePhase::Verifying
            } else {
                UpdatePhase::Downloading
            },
            Some(transfer.pending.release.clone()),
            transfer.downloaded_bytes.load(Ordering::Relaxed),
            nonzero(transfer.total_bytes.load(Ordering::Relaxed)),
        ),
        RuntimeState::Installing(pending) => (
            UpdatePhase::Installing,
            Some(pending.release.clone()),
            0,
            pending.release.download_size_bytes,
        ),
        RuntimeState::ReadyToRestart(release) => (
            UpdatePhase::ReadyToRestart,
            Some(release.clone()),
            release.download_size_bytes.unwrap_or(0),
            release.download_size_bytes,
        ),
    };

    SoftwareUpdateStatus {
        current_version: current_version.to_owned(),
        phase,
        release,
        downloaded_bytes,
        total_bytes,
        last_check: runtime.last_check.clone(),
        last_error: runtime.last_error.clone(),
        update_signing_ready: updater_public_key_is_configured(),
    }
}

fn nonzero(value: u64) -> Option<u64> {
    (value > 0).then_some(value)
}

pub(crate) fn updater_public_key() -> String {
    #[cfg(debug_assertions)]
    if let Ok(value) = std::env::var("APLENA_UPDATER_TEST_PUBLIC_KEY") {
        return value;
    }

    option_env!("APLENA_UPDATER_PUBLIC_KEY")
        .unwrap_or(UPDATE_PUBLIC_KEY_PLACEHOLDER)
        .to_owned()
}

fn updater_public_key_is_configured() -> bool {
    let public_key = updater_public_key();
    updater_public_key_is_valid(&public_key)
}

fn updater_public_key_is_valid(public_key: &str) -> bool {
    let value = public_key.trim();
    if value == UPDATE_PUBLIC_KEY_PLACEHOLDER {
        return false;
    }
    STANDARD
        .decode(value)
        .ok()
        .and_then(|bytes| String::from_utf8(bytes).ok())
        .and_then(|envelope| PublicKey::decode(&envelope).ok())
        .is_some()
}

fn updater_endpoint() -> String {
    #[cfg(debug_assertions)]
    if let Ok(value) = std::env::var("APLENA_UPDATER_TEST_ENDPOINT") {
        return value;
    }

    UPDATE_ENDPOINT.to_owned()
}

fn release_from_update(update: &Update) -> SoftwareUpdateRelease {
    SoftwareUpdateRelease {
        version: update.version.clone(),
        notes: update.body.clone(),
        published_at: update.date.map(|date| date.to_string()),
        download_size_bytes: manifest_download_size(&update.raw_json, update.download_url.as_str()),
    }
}

fn manifest_download_size(raw_json: &serde_json::Value, download_url: &str) -> Option<u64> {
    raw_json
        .get("platforms")?
        .as_object()?
        .values()
        .find(|platform| {
            platform.get("url").and_then(serde_json::Value::as_str) == Some(download_url)
        })?
        .get("size")?
        .as_u64()
}

fn classify_check_error(error: UpdaterError) -> SoftwareUpdateError {
    match error {
        UpdaterError::Reqwest(error) if error.is_timeout() => {
            SoftwareUpdateError::new("UPDATE_CHECK_TIMEOUT", "error.update_check_timeout")
        }
        UpdaterError::Reqwest(_) => SoftwareUpdateError::new(
            "UPDATE_CHECK_NETWORK_FAILED",
            "error.update_check_network_failed",
        ),
        UpdaterError::Serialization(_)
        | UpdaterError::Semver(_)
        | UpdaterError::ReleaseNotFound => {
            SoftwareUpdateError::new("UPDATE_MANIFEST_INVALID", "error.update_manifest_invalid")
        }
        UpdaterError::TargetNotFound(_)
        | UpdaterError::TargetsNotFound(_)
        | UpdaterError::UnsupportedArch
        | UpdaterError::UnsupportedOs => SoftwareUpdateError::new(
            "UPDATE_ARCHITECTURE_UNSUPPORTED",
            "error.update_architecture_unsupported",
        ),
        _ => SoftwareUpdateError::new("UPDATE_CHECK_FAILED", "error.update_check_failed"),
    }
}

fn classify_download_error(error: UpdaterError) -> SoftwareUpdateError {
    match error {
        UpdaterError::Minisign(_) | UpdaterError::Base64(_) | UpdaterError::SignatureUtf8(_) => {
            SoftwareUpdateError::new("UPDATE_SIGNATURE_INVALID", "error.update_signature_invalid")
        }
        UpdaterError::Reqwest(error) if error.is_timeout() => {
            SoftwareUpdateError::new("UPDATE_DOWNLOAD_TIMEOUT", "error.update_download_timeout")
        }
        _ => SoftwareUpdateError::new("UPDATE_DOWNLOAD_FAILED", "error.update_download_failed"),
    }
}

async fn fetch_update_candidate<R: Runtime>(
    app: &AppHandle<R>,
) -> Result<Option<Update>, SoftwareUpdateError> {
    fetch_update_candidate_with(
        app,
        &updater_endpoint(),
        updater_public_key(),
        UPDATE_CHECK_TIMEOUT,
        None,
    )
    .await
}

async fn fetch_update_candidate_with<R: Runtime>(
    app: &AppHandle<R>,
    endpoint: &str,
    public_key: String,
    check_timeout: Duration,
    target: Option<&str>,
) -> Result<Option<Update>, SoftwareUpdateError> {
    let endpoint = Url::parse(endpoint).map_err(|_| {
        SoftwareUpdateError::new(
            "UPDATE_CONFIGURATION_INVALID",
            "error.update_configuration_invalid",
        )
    })?;
    let mut builder = app
        .updater_builder()
        .pubkey(public_key)
        .endpoints(vec![endpoint])
        .map_err(classify_check_error)?;
    if let Some(target) = target {
        builder = builder.target(target);
    }
    let mut update = builder
        .timeout(check_timeout)
        .version_comparator(|current, release| {
            release.version.pre.is_empty() && release.version > current
        })
        .build()
        .map_err(classify_check_error)?
        .check()
        .await
        .map_err(classify_check_error)?;
    if let Some(candidate) = &mut update {
        candidate.timeout = Some(UPDATE_DOWNLOAD_TIMEOUT);
    }
    Ok(update)
}

#[tauri::command]
pub async fn get_software_update_preferences(
    service: State<'_, SoftwareUpdateService>,
) -> Result<SoftwareUpdatePreferences, SoftwareUpdateError> {
    let stored = service
        .store
        .get_software_update_preferences()
        .await
        .map_err(|_| SoftwareUpdateError::preferences_failed())?;
    Ok(SoftwareUpdatePreferences {
        auto_check_updates: stored.auto_check_updates,
    })
}

#[tauri::command]
pub async fn set_software_update_auto_check(
    service: State<'_, SoftwareUpdateService>,
    input: SetSoftwareUpdateAutoCheckInput,
) -> Result<SoftwareUpdatePreferences, SoftwareUpdateError> {
    let stored = service
        .store
        .set_software_update_auto_check(input.enabled, &chrono::Utc::now().to_rfc3339())
        .await
        .map_err(|_| SoftwareUpdateError::preferences_failed())?;
    Ok(SoftwareUpdatePreferences {
        auto_check_updates: stored.auto_check_updates,
    })
}

#[tauri::command]
pub async fn get_software_update_status(
    app: AppHandle,
    service: State<'_, SoftwareUpdateService>,
) -> Result<SoftwareUpdateStatus, SoftwareUpdateError> {
    let needs_persisted_check = service.runtime.lock().await.last_check.is_none();
    if needs_persisted_check
        && let Ok(stored) = service.store.get_software_update_preferences().await
        && let (Some(completed_at), Some(outcome)) = (
            stored.last_checked_at,
            stored
                .last_check_status
                .as_deref()
                .and_then(UpdateCheckOutcome::from_persisted),
        )
    {
        let mut runtime = service.runtime.lock().await;
        if runtime.last_check.is_none() {
            runtime.last_check = Some(SoftwareUpdateLastCheck {
                completed_at,
                trigger: None,
                outcome,
            });
        }
    }
    Ok(service
        .status(&app.package_info().version.to_string())
        .await)
}

#[tauri::command]
pub async fn check_software_update(
    app: AppHandle,
    service: State<'_, SoftwareUpdateService>,
    trigger: UpdateCheckTrigger,
) -> Result<SoftwareUpdateStatus, SoftwareUpdateError> {
    {
        let mut runtime = service.runtime.lock().await;
        if runtime.state.is_busy() || matches!(runtime.state, RuntimeState::ReadyToRestart(_)) {
            return Err(SoftwareUpdateError::operation_in_progress());
        }
        runtime.state = RuntimeState::Checking;
        runtime.last_error = None;
    }
    service.emit_status(&app).await;

    let check_result = fetch_update_candidate(&app).await;
    let (next_state, outcome, operation_error) = match check_result {
        Ok(Some(update)) => {
            let parsed = Version::parse(&update.version).ok();
            if parsed.as_ref().is_none_or(|version| {
                !version.pre.is_empty()
                    || Version::parse(&update.current_version)
                        .is_ok_and(|current| version <= &current)
            }) {
                (RuntimeState::Idle, UpdateCheckOutcome::UpToDate, None)
            } else {
                let release = release_from_update(&update);
                (
                    RuntimeState::Available(PendingUpdate { update, release }),
                    UpdateCheckOutcome::UpdateAvailable,
                    None,
                )
            }
        }
        Ok(None) => (RuntimeState::Idle, UpdateCheckOutcome::UpToDate, None),
        Err(error) => (RuntimeState::Idle, UpdateCheckOutcome::Failed, Some(error)),
    };
    let (last_check, persistence_error) = service.record_check(trigger, outcome).await;
    let returned_error = operation_error.or(persistence_error);
    {
        let mut runtime = service.runtime.lock().await;
        runtime.state = next_state;
        runtime.last_check = Some(last_check);
        runtime.last_error = returned_error.clone();
    }
    service.emit_status(&app).await;
    if let Some(error) = returned_error {
        Err(error)
    } else {
        Ok(service
            .status(&app.package_info().version.to_string())
            .await)
    }
}

#[tauri::command]
pub async fn download_and_install_software_update(
    app: AppHandle,
    service: State<'_, SoftwareUpdateService>,
) -> Result<SoftwareUpdateStatus, SoftwareUpdateError> {
    if !updater_public_key_is_configured() {
        return Err(SoftwareUpdateError::new(
            "UPDATE_SIGNING_KEY_NOT_CONFIGURED",
            "error.update_signing_key_not_configured",
        ));
    }

    let (pending, cancel_rx, downloaded_bytes, total_bytes, verifying, last_check) = {
        let mut runtime = service.runtime.lock().await;
        let RuntimeState::Available(pending) = &runtime.state else {
            return Err(SoftwareUpdateError::operation_in_progress());
        };
        let pending = pending.clone();
        let downloaded_bytes = Arc::new(AtomicU64::new(0));
        let total_bytes = Arc::new(AtomicU64::new(
            pending.release.download_size_bytes.unwrap_or(0),
        ));
        let verifying = Arc::new(AtomicBool::new(false));
        let (cancel_tx, cancel_rx) = oneshot::channel();
        runtime.state = RuntimeState::Transferring(TransferState {
            pending: pending.clone(),
            verifying: Arc::clone(&verifying),
            downloaded_bytes: Arc::clone(&downloaded_bytes),
            total_bytes: Arc::clone(&total_bytes),
            cancel: Some(cancel_tx),
        });
        runtime.last_error = None;
        (
            pending,
            cancel_rx,
            downloaded_bytes,
            total_bytes,
            verifying,
            runtime.last_check.clone(),
        )
    };
    service.emit_status(&app).await;

    let progress_app = app.clone();
    let progress_release = pending.release.clone();
    let progress_downloaded = Arc::clone(&downloaded_bytes);
    let progress_total = Arc::clone(&total_bytes);
    let progress_last_check = last_check.clone();
    let finish_app = app.clone();
    let finish_release = pending.release.clone();
    let finish_downloaded = Arc::clone(&downloaded_bytes);
    let finish_total = Arc::clone(&total_bytes);
    let finish_verifying = Arc::clone(&verifying);
    let finish_last_check = last_check;
    let update = pending.update.clone();
    let download = update.download(
        move |chunk_size, content_length| {
            let downloaded = progress_downloaded.fetch_add(chunk_size as u64, Ordering::Relaxed)
                + chunk_size as u64;
            if let Some(total) = content_length {
                progress_total.store(total, Ordering::Relaxed);
            }
            let _ = progress_app.emit(
                SOFTWARE_UPDATE_STATUS_EVENT,
                SoftwareUpdateStatus {
                    current_version: progress_app.package_info().version.to_string(),
                    phase: UpdatePhase::Downloading,
                    release: Some(progress_release.clone()),
                    downloaded_bytes: downloaded,
                    total_bytes: nonzero(progress_total.load(Ordering::Relaxed)),
                    last_check: progress_last_check.clone(),
                    last_error: None,
                    update_signing_ready: true,
                },
            );
        },
        move || {
            finish_verifying.store(true, Ordering::Release);
            let _ = finish_app.emit(
                SOFTWARE_UPDATE_STATUS_EVENT,
                SoftwareUpdateStatus {
                    current_version: finish_app.package_info().version.to_string(),
                    phase: UpdatePhase::Verifying,
                    release: Some(finish_release.clone()),
                    downloaded_bytes: finish_downloaded.load(Ordering::Relaxed),
                    total_bytes: nonzero(finish_total.load(Ordering::Relaxed)),
                    last_check: finish_last_check.clone(),
                    last_error: None,
                    update_signing_ready: true,
                },
            );
        },
    );
    tokio::pin!(download);
    let bytes = tokio::select! {
        biased;
        _ = cancel_rx => None,
        result = &mut download => Some(result.map_err(classify_download_error)),
    };

    let bytes = match bytes {
        Some(Ok(bytes)) => bytes,
        None => {
            service.emit_status(&app).await;
            return Ok(service
                .status(&app.package_info().version.to_string())
                .await);
        }
        Some(Err(error)) => {
            let mut runtime = service.runtime.lock().await;
            runtime.state = RuntimeState::Available(pending);
            runtime.last_error = Some(error.clone());
            drop(runtime);
            service.emit_status(&app).await;
            return Err(error);
        }
    };

    {
        let mut runtime = service.runtime.lock().await;
        runtime.state = RuntimeState::Installing(pending.clone());
    }
    service.emit_status(&app).await;

    let expected_version = pending.release.version.clone();
    let install_result = match tauri::async_runtime::spawn_blocking(move || {
        safe_macos::install_verified_update(&bytes, &expected_version)
    })
    .await
    {
        Ok(Ok(receipt)) => Ok(receipt),
        Ok(Err(_)) | Err(_) => Err(SoftwareUpdateError::new(
            "UPDATE_INSTALL_FAILED",
            "error.update_install_failed",
        )
        .with_version(&pending.release.version)),
    };

    match install_result {
        Ok(_receipt) => {
            let mut runtime = service.runtime.lock().await;
            runtime.state = RuntimeState::ReadyToRestart(pending.release.clone());
            runtime.last_error = None;
            drop(runtime);
            service.emit_status(&app).await;
            Ok(service
                .status(&app.package_info().version.to_string())
                .await)
        }
        Err(error) => {
            let mut runtime = service.runtime.lock().await;
            runtime.state = RuntimeState::Available(pending);
            runtime.last_error = Some(error.clone());
            drop(runtime);
            service.emit_status(&app).await;
            Err(error)
        }
    }
}

#[tauri::command]
pub async fn cancel_software_update(
    app: AppHandle,
    service: State<'_, SoftwareUpdateService>,
) -> Result<SoftwareUpdateStatus, SoftwareUpdateError> {
    let sender = {
        let mut runtime = service.runtime.lock().await;
        match &mut runtime.state {
            RuntimeState::Transferring(transfer) if !transfer.verifying.load(Ordering::Acquire) => {
                let sender = transfer.cancel.take();
                let pending = transfer.pending.clone();
                runtime.state = RuntimeState::Available(pending);
                runtime.last_error = None;
                sender
            }
            _ => None,
        }
    }
    .ok_or_else(SoftwareUpdateError::operation_in_progress)?;
    let _ = sender.send(());
    service.emit_status(&app).await;
    Ok(service
        .status(&app.package_info().version.to_string())
        .await)
}

#[tauri::command]
pub async fn restart_after_software_update(
    app: AppHandle,
    service: State<'_, SoftwareUpdateService>,
) -> Result<(), SoftwareUpdateError> {
    if !matches!(
        service.runtime.lock().await.state,
        RuntimeState::ReadyToRestart(_)
    ) {
        return Err(SoftwareUpdateError::new(
            "UPDATE_NOT_READY_TO_RESTART",
            "error.update_not_ready_to_restart",
        ));
    }
    app.restart()
}

pub(crate) fn cleanup_stale_update_backups() {
    let _ = safe_macos::cleanup_stale_update_backups();
}

#[cfg(test)]
mod tests {
    use super::{
        UPDATE_DOWNLOAD_TIMEOUT, UPDATE_PUBLIC_KEY_PLACEHOLDER, UpdateCheckOutcome,
        classify_download_error, fetch_update_candidate_with, manifest_download_size, nonzero,
        updater_public_key_is_valid,
    };
    use std::{
        io::{Read, Write},
        net::TcpListener,
        thread,
        time::Duration,
    };
    use tauri::test::{mock_builder, mock_context, noop_assets};

    const TEST_PUBLIC_KEY: &str = "dW50cnVzdGVkIGNvbW1lbnQ6IG1pbmlzaWduIHB1YmxpYyBrZXk6IDMwQzk1QUFGNzBDQkMyMjkKUldRcHdzdHdyMXJKTURKQUdudE95VlZnQldiMFpvWW9hV0RqT1pTSVFDSVliODJtb0t3MVhxS2kK";
    const TEST_SIGNATURE: &str = "dW50cnVzdGVkIGNvbW1lbnQ6IHNpZ25hdHVyZSBmcm9tIHRhdXJpIHNlY3JldCBrZXkKUlVRcHdzdHdyMXJKTUc0b0NRZEQ4cGhrTi8xWTdLdTFjaUYxWUtkaDM2SDM3TFR6Ulp6ODlRemRJQk5ESTIrYlVmWTBjN00rVVlwSlRuVEpNRXE1aHoyZG16V3VDa0l4NlFJPQp0cnVzdGVkIGNvbW1lbnQ6IHRpbWVzdGFtcDoxNzg4NzkwNjU2CWZpbGU6cGF5bG9hZC5iaW4KZXU4bDc4ME1ZZUpHNVpKWXk2ckMrT1N2aTdSMWliTjlWbTEwK2NCb1FNR0VZOGhiaUMxMTk4TmNCc3VHSVE3Tjl4c3VxMWI2bTY0SEZlYUJOelpJQWc9PQo=";
    const TEST_PAYLOAD: &[u8] = b"verified-updater-fixture\n";

    struct TestResponse {
        status: &'static str,
        content_type: &'static str,
        body: Vec<u8>,
        delay: Duration,
    }

    fn serve(
        build_responses: impl FnOnce(&str) -> Vec<TestResponse>,
    ) -> (String, thread::JoinHandle<()>) {
        let listener = TcpListener::bind("127.0.0.1:0").expect("bind updater test server");
        let address = listener.local_addr().expect("local updater server address");
        let base_url = format!("http://{address}");
        let responses = build_responses(&base_url);
        let handle = thread::spawn(move || {
            for response in responses {
                let (mut stream, _) = listener.accept().expect("accept updater request");
                let mut request = [0_u8; 4096];
                let _ = stream.read(&mut request).expect("read updater request");
                if !response.delay.is_zero() {
                    thread::sleep(response.delay);
                }
                write!(
                    stream,
                    "HTTP/1.1 {}\r\nContent-Type: {}\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
                    response.status,
                    response.content_type,
                    response.body.len()
                )
                .expect("write updater response headers");
                stream
                    .write_all(&response.body)
                    .expect("write updater response body");
            }
        });
        (base_url, handle)
    }

    fn manifest(base_url: &str, version: &str, signature: &str) -> Vec<u8> {
        serde_json::to_vec(&serde_json::json!({
            "version": version,
            "notes": "Updater integration fixture",
            "pub_date": "2026-09-07T00:00:00Z",
            "platforms": {
                "darwin-aarch64": {
                    "url": format!("{base_url}/arm64.tar.gz"),
                    "signature": signature,
                    "size": TEST_PAYLOAD.len()
                },
                "darwin-x86_64": {
                    "url": format!("{base_url}/x86_64.tar.gz"),
                    "signature": signature,
                    "size": TEST_PAYLOAD.len()
                }
            }
        }))
        .expect("serialize updater manifest")
    }

    fn mock_app() -> tauri::App<tauri::test::MockRuntime> {
        let mut context = mock_context(noop_assets());
        context.config_mut().plugins.0.insert(
            "updater".to_owned(),
            serde_json::json!({
                "pubkey": TEST_PUBLIC_KEY,
                "endpoints": []
            }),
        );
        mock_builder()
            .plugin(
                tauri_plugin_updater::Builder::new()
                    .pubkey(TEST_PUBLIC_KEY)
                    .build(),
            )
            .build(context)
            .expect("build mock updater app")
    }

    #[test]
    fn manifest_size_is_selected_by_exact_download_url() {
        let manifest = serde_json::json!({
            "platforms": {
                "darwin-aarch64": {
                    "url": "https://example.invalid/arm.tar.gz",
                    "signature": "arm",
                    "size": 123
                },
                "darwin-x86_64": {
                    "url": "https://example.invalid/intel.tar.gz",
                    "signature": "intel",
                    "size": 456
                }
            }
        });
        assert_eq!(
            manifest_download_size(&manifest, "https://example.invalid/arm.tar.gz"),
            Some(123)
        );
        assert_eq!(
            manifest_download_size(&manifest, "https://example.invalid/missing.tar.gz"),
            None
        );
    }

    #[test]
    fn persisted_outcomes_are_strict() {
        assert_eq!(
            UpdateCheckOutcome::from_persisted("UP_TO_DATE"),
            Some(UpdateCheckOutcome::UpToDate)
        );
        assert_eq!(UpdateCheckOutcome::from_persisted("up_to_date"), None);
    }

    #[test]
    fn zero_content_length_remains_unknown() {
        assert_eq!(nonzero(0), None);
        assert_eq!(nonzero(1), Some(1));
        assert!(UPDATE_PUBLIC_KEY_PLACEHOLDER.contains("REQUIRED"));
    }

    #[test]
    fn signing_readiness_requires_a_parseable_minisign_public_key() {
        assert!(updater_public_key_is_valid(TEST_PUBLIC_KEY));
        assert!(!updater_public_key_is_valid(&"x".repeat(100)));
        assert!(!updater_public_key_is_valid(UPDATE_PUBLIC_KEY_PLACEHOLDER));
    }

    #[tokio::test]
    async fn check_selects_stable_updates_for_both_supported_macos_architectures() {
        for target in ["darwin-aarch64", "darwin-x86_64"] {
            let listener = TcpListener::bind("127.0.0.1:0").expect("bind updater test server");
            let address = listener.local_addr().expect("local updater server address");
            let base_url = format!("http://{address}");
            let body = manifest(&base_url, "1.2.0", TEST_SIGNATURE);
            let handle = thread::spawn(move || {
                let (mut stream, _) = listener.accept().expect("accept updater request");
                let mut request = [0_u8; 4096];
                let _ = stream.read(&mut request).expect("read updater request");
                write!(
                    stream,
                    "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
                    body.len()
                )
                .expect("write updater response headers");
                stream
                    .write_all(&body)
                    .expect("write updater response body");
            });
            let app = mock_app();
            let update = fetch_update_candidate_with(
                app.handle(),
                &format!("{base_url}/latest.json"),
                TEST_PUBLIC_KEY.to_owned(),
                Duration::from_secs(2),
                Some(target),
            )
            .await
            .expect("check succeeds")
            .expect("new stable update");
            assert_eq!(update.version, "1.2.0");
            assert!(
                update
                    .download_url
                    .path()
                    .contains(if target.ends_with("aarch64") {
                        "arm64"
                    } else {
                        "x86_64"
                    })
            );
            assert_eq!(update.timeout, Some(UPDATE_DOWNLOAD_TIMEOUT));
            handle.join().expect("updater server exits");
        }
    }

    #[tokio::test]
    async fn check_ignores_equal_and_prerelease_versions() {
        for version in ["0.1.0", "1.2.0-beta.1"] {
            let listener = TcpListener::bind("127.0.0.1:0").expect("bind updater test server");
            let address = listener.local_addr().expect("local updater server address");
            let base_url = format!("http://{address}");
            let body = manifest(&base_url, version, TEST_SIGNATURE);
            let handle = thread::spawn(move || {
                let (mut stream, _) = listener.accept().expect("accept updater request");
                let mut request = [0_u8; 4096];
                let _ = stream.read(&mut request).expect("read updater request");
                write!(
                    stream,
                    "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
                    body.len()
                )
                .expect("write updater response headers");
                stream
                    .write_all(&body)
                    .expect("write updater response body");
            });
            let app = mock_app();
            assert!(
                fetch_update_candidate_with(
                    app.handle(),
                    &format!("{base_url}/latest.json"),
                    TEST_PUBLIC_KEY.to_owned(),
                    Duration::from_secs(2),
                    Some("darwin-aarch64"),
                )
                .await
                .expect("check succeeds")
                .is_none()
            );
            handle.join().expect("updater server exits");
        }
    }

    #[tokio::test]
    async fn signed_download_is_accepted_and_tampering_is_rejected() {
        for (payload, expected_error) in [
            (TEST_PAYLOAD.to_vec(), None),
            (
                b"tampered-updater-fixture\n".to_vec(),
                Some("UPDATE_SIGNATURE_INVALID"),
            ),
        ] {
            let (base_url, handle) = serve(|base_url| {
                vec![
                    TestResponse {
                        status: "200 OK",
                        content_type: "application/json",
                        body: manifest(base_url, "1.2.0", TEST_SIGNATURE),
                        delay: Duration::ZERO,
                    },
                    TestResponse {
                        status: "200 OK",
                        content_type: "application/octet-stream",
                        body: payload,
                        delay: Duration::ZERO,
                    },
                ]
            });
            let app = mock_app();
            let update = fetch_update_candidate_with(
                app.handle(),
                &format!("{base_url}/latest.json"),
                TEST_PUBLIC_KEY.to_owned(),
                Duration::from_secs(2),
                Some("darwin-aarch64"),
            )
            .await
            .expect("check succeeds")
            .expect("new update");
            let result = update.download(|_, _| {}, || {}).await;
            match expected_error {
                None => assert_eq!(result.expect("valid signature"), TEST_PAYLOAD),
                Some(error_code) => assert_eq!(
                    classify_download_error(result.expect_err("invalid signature")).error_code,
                    error_code
                ),
            }
            handle.join().expect("updater server exits");
        }
    }

    #[tokio::test]
    async fn invalid_manifest_and_timeout_have_distinct_safe_errors() {
        let (base_url, handle) = serve(|_| {
            vec![TestResponse {
                status: "200 OK",
                content_type: "application/json",
                body: b"{\"not\":\"a release\"}".to_vec(),
                delay: Duration::ZERO,
            }]
        });
        let app = mock_app();
        let error = match fetch_update_candidate_with(
            app.handle(),
            &format!("{base_url}/latest.json"),
            TEST_PUBLIC_KEY.to_owned(),
            Duration::from_secs(2),
            Some("darwin-aarch64"),
        )
        .await
        {
            Err(error) => error,
            Ok(_) => panic!("invalid manifest was accepted"),
        };
        assert_eq!(error.error_code, "UPDATE_MANIFEST_INVALID");
        handle.join().expect("updater server exits");

        let (base_url, handle) = serve(|_| {
            vec![TestResponse {
                status: "200 OK",
                content_type: "application/json",
                body: b"{}".to_vec(),
                delay: Duration::from_millis(150),
            }]
        });
        let app = mock_app();
        let error = match fetch_update_candidate_with(
            app.handle(),
            &format!("{base_url}/latest.json"),
            TEST_PUBLIC_KEY.to_owned(),
            Duration::from_millis(25),
            Some("darwin-aarch64"),
        )
        .await
        {
            Err(error) => error,
            Ok(_) => panic!("timed-out check succeeded"),
        };
        assert_eq!(error.error_code, "UPDATE_CHECK_TIMEOUT");
        handle.join().expect("updater server exits");
    }
}
