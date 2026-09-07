use std::path::PathBuf;

const APLENA_BUNDLE_IDENTIFIER: &str = "li.morton.aplena";
const APLENA_SIGNING_CERTIFICATE_SHA256: &str =
    "FEEE897C91F36CAFE6AE34CD4AD50F701C89D688DF68DD22D09E0FFD77635FEB";

#[derive(Debug, thiserror::Error)]
pub(crate) enum SafeInstallError {
    #[cfg(not(target_os = "macos"))]
    #[error("software updates can only be installed on macOS")]
    UnsupportedPlatform,
    #[cfg(target_os = "macos")]
    #[error("the running executable is not inside a macOS application bundle")]
    NotRunningFromAppBundle,
    #[cfg(target_os = "macos")]
    #[error("unsupported update architecture `{0}`")]
    UnsupportedArchitecture(&'static str),
    #[cfg(target_os = "macos")]
    #[error("{operation} failed for {path:?}: {source}")]
    Io {
        operation: &'static str,
        path: PathBuf,
        #[source]
        source: std::io::Error,
    },
    #[cfg(target_os = "macos")]
    #[error("invalid updater archive: {0}")]
    InvalidArchive(String),
    #[cfg(target_os = "macos")]
    #[error("invalid application bundle: {0}")]
    InvalidBundle(String),
    #[cfg(target_os = "macos")]
    #[error("{program} failed while {operation}: {stderr}")]
    CommandFailed {
        program: &'static str,
        operation: &'static str,
        stderr: String,
    },
    #[cfg(target_os = "macos")]
    #[error(
        "the update was not signed by the expected certificate (expected {expected}, got {actual})"
    )]
    CertificateMismatch { expected: String, actual: String },
    #[cfg(target_os = "macos")]
    #[error("the installed application changed while the update was being prepared")]
    InstalledBundleChanged,
    #[cfg(target_os = "macos")]
    #[error("the staged application is not on the same volume as the installed application")]
    CrossVolumeStaging,
    #[cfg(target_os = "macos")]
    #[error(
        "the atomic application exchange failed; the installed application was left unchanged: {0}"
    )]
    AtomicExchange(#[source] std::io::Error),
}

#[derive(Debug, Clone)]
pub(crate) struct InstallReceipt {
    // The service deliberately leaves this path for the next successfully
    // launched version to clean. It is not otherwise needed by the current
    // process, so keep the unused-field allowance narrowly scoped here.
    #[allow(dead_code)]
    pub(crate) retained_backup_dir: PathBuf,
}

/// Installs bytes already authenticated by `tauri-plugin-updater`.
///
/// On macOS the new bundle is fully extracted and validated before a single
/// `RENAME_SWAP` operation atomically exchanges it with the running bundle.
/// No two-rename or privileged shell fallback is used: if atomic exchange is
/// unavailable or fails, the installed bundle remains untouched.
pub(crate) fn install_verified_update(
    bytes: &[u8],
    expected_version: &str,
) -> Result<InstallReceipt, SafeInstallError> {
    #[cfg(target_os = "macos")]
    {
        imp::install_verified_update(bytes, expected_version)
    }

    #[cfg(not(target_os = "macos"))]
    {
        let _ = (bytes, expected_version);
        Err(SafeInstallError::UnsupportedPlatform)
    }
}

/// Performs best-effort cleanup of staging/backup directories left by an
/// earlier safe update. Call this function on a blocking worker during startup.
pub(crate) fn cleanup_stale_update_backups() -> Result<usize, SafeInstallError> {
    #[cfg(target_os = "macos")]
    {
        imp::cleanup_stale_update_backups()
    }

    #[cfg(not(target_os = "macos"))]
    Ok(0)
}

#[cfg(target_os = "macos")]
mod imp {
    use super::{
        APLENA_BUNDLE_IDENTIFIER, APLENA_SIGNING_CERTIFICATE_SHA256, InstallReceipt,
        SafeInstallError,
    };
    use flate2::read::GzDecoder;
    use sha2::{Digest, Sha256};
    use std::{
        ffi::{CString, OsStr, OsString},
        fs,
        io::{Cursor, Read},
        os::{unix::ffi::OsStrExt, unix::fs::MetadataExt},
        path::{Component, Path, PathBuf},
        process::{Command, Output},
    };

    const STAGING_PREFIX: &str = ".aplena-safe-update-";
    const ARCHIVE_BUNDLE_NAME: &str = "Aplena.app";
    const BACKUP_MARKER: &str = ".aplena-safe-update-backup-v1";
    const BACKUP_MARKER_CONTENT: &[u8] = b"APLENA_SAFE_UPDATE_BACKUP_V1\n";
    const MAX_ARCHIVE_BYTES: usize = 512 * 1024 * 1024;
    const MAX_ARCHIVE_ENTRIES: usize = 100_000;
    const MAX_EXTRACTED_BYTES: u64 = 2 * 1024 * 1024 * 1024;

    pub(super) fn install_verified_update(
        bytes: &[u8],
        expected_version: &str,
    ) -> Result<InstallReceipt, SafeInstallError> {
        let installed_bundle = current_app_bundle()?;
        let expected_architecture = current_architecture()?;
        let policy = ValidationPolicy {
            bundle_identifier: APLENA_BUNDLE_IDENTIFIER,
            version: expected_version,
            architecture: expected_architecture,
            certificate_sha256: APLENA_SIGNING_CERTIFICATE_SHA256,
        };

        install_with_components(
            bytes,
            &installed_bundle,
            &MacBundleValidator {
                policy,
                commands: SystemCommandRunner,
            },
            &MacAtomicSwap,
        )
    }

    pub(super) fn cleanup_stale_update_backups() -> Result<usize, SafeInstallError> {
        let installed_bundle = current_app_bundle()?;
        cleanup_backups_for_bundle(&installed_bundle)
    }

    fn install_with_components(
        bytes: &[u8],
        installed_bundle: &Path,
        validator: &dyn BundleValidator,
        atomic_swap: &dyn AtomicSwap,
    ) -> Result<InstallReceipt, SafeInstallError> {
        if bytes.is_empty() {
            return Err(SafeInstallError::InvalidArchive(
                "the archive is empty".to_string(),
            ));
        }
        if bytes.len() > MAX_ARCHIVE_BYTES {
            return Err(SafeInstallError::InvalidArchive(format!(
                "compressed archive exceeds the {MAX_ARCHIVE_BYTES}-byte limit"
            )));
        }

        let installed_bundle = validate_installed_bundle(installed_bundle)?;
        let installed_identity = file_identity(&installed_bundle)?;
        let parent = installed_bundle.parent().ok_or_else(|| {
            SafeInstallError::InvalidBundle("installed bundle has no parent".to_string())
        })?;
        // `tempdir_in(parent)` is the critical cross-volume invariant: the
        // staged bundle and installed bundle necessarily occupy the same
        // filesystem before RENAME_SWAP is attempted.
        let staging_dir = tempfile::Builder::new()
            .prefix(STAGING_PREFIX)
            .tempdir_in(parent)
            .map_err(|source| SafeInstallError::Io {
                operation: "create same-volume update staging directory",
                path: parent.to_path_buf(),
                source,
            })?;
        write_backup_marker(staging_dir.path())?;

        extract_archive(bytes, staging_dir.path(), OsStr::new(ARCHIVE_BUNDLE_NAME))?;
        let staged_bundle = staging_dir.path().join(ARCHIVE_BUNDLE_NAME);
        let staged_metadata =
            fs::symlink_metadata(&staged_bundle).map_err(|source| SafeInstallError::Io {
                operation: "inspect staged application bundle",
                path: staged_bundle.clone(),
                source,
            })?;
        if staged_metadata.file_type().is_symlink() || !staged_metadata.is_dir() {
            return Err(SafeInstallError::InvalidBundle(
                "the archive root is not a regular application bundle directory".to_string(),
            ));
        }
        if staged_metadata.dev() != installed_identity.device {
            return Err(SafeInstallError::CrossVolumeStaging);
        }

        validator.validate(&staged_bundle)?;

        // Re-check immediately before the only operation that can modify the
        // installed path. This prevents a concurrent/manual replacement from
        // being exchanged after we validated a different bundle.
        if file_identity(&installed_bundle)? != installed_identity {
            return Err(SafeInstallError::InstalledBundleChanged);
        }

        atomic_swap
            .exchange(&staged_bundle, &installed_bundle)
            .map_err(SafeInstallError::AtomicExchange)?;

        // No fallible operation may occur between a successful exchange and
        // retaining the TempDir. The staging path now contains the old app;
        // keeping it gives the caller an explicit post-relaunch cleanup point.
        let retained_backup_dir = staging_dir.keep();

        Ok(InstallReceipt {
            retained_backup_dir,
        })
    }

    fn validate_installed_bundle(path: &Path) -> Result<PathBuf, SafeInstallError> {
        let metadata = fs::symlink_metadata(path).map_err(|source| SafeInstallError::Io {
            operation: "inspect installed application bundle",
            path: path.to_path_buf(),
            source,
        })?;
        if metadata.file_type().is_symlink() || !metadata.is_dir() {
            return Err(SafeInstallError::InvalidBundle(
                "the installed application path is not a regular directory".to_string(),
            ));
        }
        if path.extension() != Some(OsStr::new("app")) {
            return Err(SafeInstallError::InvalidBundle(
                "the installed application path does not end in .app".to_string(),
            ));
        }

        fs::canonicalize(path).map_err(|source| SafeInstallError::Io {
            operation: "canonicalize installed application bundle",
            path: path.to_path_buf(),
            source,
        })
    }

    fn current_app_bundle() -> Result<PathBuf, SafeInstallError> {
        let executable = std::env::current_exe().map_err(|source| SafeInstallError::Io {
            operation: "locate running executable",
            path: PathBuf::from("<current executable>"),
            source,
        })?;

        executable
            .ancestors()
            .find(|candidate| candidate.extension() == Some(OsStr::new("app")))
            .map(Path::to_path_buf)
            .ok_or(SafeInstallError::NotRunningFromAppBundle)
            .and_then(|path| validate_installed_bundle(&path))
    }

    fn current_architecture() -> Result<&'static str, SafeInstallError> {
        match std::env::consts::ARCH {
            "aarch64" => Ok("arm64"),
            "x86_64" => Ok("x86_64"),
            architecture => Err(SafeInstallError::UnsupportedArchitecture(architecture)),
        }
    }

    fn write_backup_marker(staging_dir: &Path) -> Result<(), SafeInstallError> {
        let marker = staging_dir.join(BACKUP_MARKER);
        fs::write(&marker, BACKUP_MARKER_CONTENT).map_err(|source| SafeInstallError::Io {
            operation: "write safe-update marker",
            path: marker,
            source,
        })
    }

    fn extract_archive(
        bytes: &[u8],
        destination: &Path,
        expected_root: &OsStr,
    ) -> Result<(), SafeInstallError> {
        let decoder = GzDecoder::new(Cursor::new(bytes));
        let mut archive = tar::Archive::new(decoder);
        let entries = archive.entries().map_err(|error| {
            SafeInstallError::InvalidArchive(format!("cannot read tar entries: {error}"))
        })?;
        let mut entry_count = 0usize;
        let mut extracted_bytes = 0u64;
        let mut saw_bundle_root = false;

        for entry in entries {
            entry_count += 1;
            if entry_count > MAX_ARCHIVE_ENTRIES {
                return Err(SafeInstallError::InvalidArchive(format!(
                    "archive exceeds the {MAX_ARCHIVE_ENTRIES}-entry limit"
                )));
            }

            let mut entry = entry.map_err(|error| {
                SafeInstallError::InvalidArchive(format!("cannot read tar entry: {error}"))
            })?;
            let entry_path = entry
                .path()
                .map_err(|error| {
                    SafeInstallError::InvalidArchive(format!("invalid tar path: {error}"))
                })?
                .into_owned();
            validate_archive_path(&entry_path, expected_root)?;
            saw_bundle_root = true;

            let entry_type = entry.header().entry_type();
            if !(entry_type.is_file()
                || entry_type.is_dir()
                || entry_type.is_symlink()
                || entry_type.is_hard_link())
            {
                return Err(SafeInstallError::InvalidArchive(format!(
                    "unsupported tar entry type for {}",
                    entry_path.display()
                )));
            }

            let entry_size = entry.header().size().map_err(|error| {
                SafeInstallError::InvalidArchive(format!(
                    "invalid size for {}: {error}",
                    entry_path.display()
                ))
            })?;
            extracted_bytes = extracted_bytes.checked_add(entry_size).ok_or_else(|| {
                SafeInstallError::InvalidArchive("archive size overflow".to_string())
            })?;
            if extracted_bytes > MAX_EXTRACTED_BYTES {
                return Err(SafeInstallError::InvalidArchive(format!(
                    "expanded archive exceeds the {MAX_EXTRACTED_BYTES}-byte limit"
                )));
            }

            if entry_type.is_symlink() || entry_type.is_hard_link() {
                let target = entry
                    .link_name()
                    .map_err(|error| {
                        SafeInstallError::InvalidArchive(format!(
                            "invalid link target for {}: {error}",
                            entry_path.display()
                        ))
                    })?
                    .ok_or_else(|| {
                        SafeInstallError::InvalidArchive(format!(
                            "missing link target for {}",
                            entry_path.display()
                        ))
                    })?;
                if entry_type.is_symlink() {
                    validate_symlink_target(&entry_path, &target)?;
                } else {
                    validate_archive_path(&target, expected_root)?;
                }
            }

            if !entry.unpack_in(destination).map_err(|error| {
                SafeInstallError::InvalidArchive(format!(
                    "cannot extract {}: {error}",
                    entry_path.display()
                ))
            })? {
                return Err(SafeInstallError::InvalidArchive(format!(
                    "tar entry escapes the staging directory: {}",
                    entry_path.display()
                )));
            }
        }

        if !saw_bundle_root {
            return Err(SafeInstallError::InvalidArchive(
                "archive contains no application bundle".to_string(),
            ));
        }
        Ok(())
    }

    fn validate_archive_path(path: &Path, expected_root: &OsStr) -> Result<(), SafeInstallError> {
        let mut components = path.components();
        match components.next() {
            Some(Component::Normal(root)) if root == expected_root => {}
            _ => {
                return Err(SafeInstallError::InvalidArchive(format!(
                    "every archive entry must be rooted at {:?}: {}",
                    expected_root,
                    path.display()
                )));
            }
        }

        if components.any(|component| !matches!(component, Component::Normal(_))) {
            return Err(SafeInstallError::InvalidArchive(format!(
                "archive path contains an unsafe component: {}",
                path.display()
            )));
        }
        Ok(())
    }

    fn validate_symlink_target(entry_path: &Path, target: &Path) -> Result<(), SafeInstallError> {
        if target.as_os_str().is_empty() || target.is_absolute() {
            return Err(SafeInstallError::InvalidArchive(format!(
                "unsafe symlink target {} for {}",
                target.display(),
                entry_path.display()
            )));
        }

        // Archive paths are already known to consist only of Normal
        // components. A depth of one is the .app root; links may navigate
        // within that root but never above it.
        let mut depth = entry_path
            .parent()
            .map(|parent| parent.components().count())
            .unwrap_or(0);
        for component in target.components() {
            match component {
                Component::Normal(_) => depth += 1,
                Component::CurDir => {}
                Component::ParentDir if depth > 1 => depth -= 1,
                _ => {
                    return Err(SafeInstallError::InvalidArchive(format!(
                        "symlink target escapes the application bundle: {} -> {}",
                        entry_path.display(),
                        target.display()
                    )));
                }
            }
        }
        Ok(())
    }

    #[derive(Debug, Clone, Copy, PartialEq, Eq)]
    struct FileIdentity {
        device: u64,
        inode: u64,
    }

    fn file_identity(path: &Path) -> Result<FileIdentity, SafeInstallError> {
        let metadata = fs::symlink_metadata(path).map_err(|source| SafeInstallError::Io {
            operation: "read application bundle identity",
            path: path.to_path_buf(),
            source,
        })?;
        Ok(FileIdentity {
            device: metadata.dev(),
            inode: metadata.ino(),
        })
    }

    trait AtomicSwap {
        fn exchange(&self, staged: &Path, installed: &Path) -> std::io::Result<()>;
    }

    struct MacAtomicSwap;

    impl AtomicSwap for MacAtomicSwap {
        fn exchange(&self, staged: &Path, installed: &Path) -> std::io::Result<()> {
            let staged = CString::new(staged.as_os_str().as_bytes()).map_err(|_| {
                std::io::Error::new(
                    std::io::ErrorKind::InvalidInput,
                    "staged path contains a NUL byte",
                )
            })?;
            let installed = CString::new(installed.as_os_str().as_bytes()).map_err(|_| {
                std::io::Error::new(
                    std::io::ErrorKind::InvalidInput,
                    "installed path contains a NUL byte",
                )
            })?;

            // SAFETY: both C strings are NUL-terminated and remain alive for
            // the duration of the call. RENAME_SWAP is a single atomic kernel
            // operation; on error neither directory entry is modified.
            let result =
                unsafe { libc::renamex_np(staged.as_ptr(), installed.as_ptr(), libc::RENAME_SWAP) };
            if result == 0 {
                Ok(())
            } else {
                Err(std::io::Error::last_os_error())
            }
        }
    }

    trait BundleValidator {
        fn validate(&self, bundle: &Path) -> Result<(), SafeInstallError>;
    }

    struct ValidationPolicy<'a> {
        bundle_identifier: &'a str,
        version: &'a str,
        architecture: &'a str,
        certificate_sha256: &'a str,
    }

    struct MacBundleValidator<'a, C> {
        policy: ValidationPolicy<'a>,
        commands: C,
    }

    impl<C: CommandRunner> BundleValidator for MacBundleValidator<'_, C> {
        fn validate(&self, bundle: &Path) -> Result<(), SafeInstallError> {
            let info_path = bundle.join("Contents/Info.plist");
            ensure_regular_file(&info_path, "Info.plist")?;
            let info = plist::Value::from_file(&info_path).map_err(|error| {
                SafeInstallError::InvalidBundle(format!(
                    "cannot parse {}: {error}",
                    info_path.display()
                ))
            })?;
            let dictionary = info.as_dictionary().ok_or_else(|| {
                SafeInstallError::InvalidBundle("Info.plist is not a dictionary".to_string())
            })?;

            let bundle_identifier = required_plist_string(dictionary, "CFBundleIdentifier")?;
            if bundle_identifier != self.policy.bundle_identifier {
                return Err(SafeInstallError::InvalidBundle(format!(
                    "expected bundle identifier {}, got {bundle_identifier}",
                    self.policy.bundle_identifier
                )));
            }
            let version = required_plist_string(dictionary, "CFBundleShortVersionString")?;
            if version != self.policy.version {
                return Err(SafeInstallError::InvalidBundle(format!(
                    "expected version {}, got {version}",
                    self.policy.version
                )));
            }

            let executable_name = required_plist_string(dictionary, "CFBundleExecutable")?;
            let executable_component = Path::new(executable_name);
            if executable_component.components().count() != 1
                || !matches!(
                    executable_component.components().next(),
                    Some(Component::Normal(_))
                )
            {
                return Err(SafeInstallError::InvalidBundle(
                    "CFBundleExecutable must contain a single file name".to_string(),
                ));
            }
            let executable = bundle.join("Contents/MacOS").join(executable_component);
            ensure_regular_file(&executable, "application executable")?;

            let lipo = run_command(
                &self.commands,
                "/usr/bin/lipo",
                &[OsString::from("-archs"), executable.as_os_str().to_owned()],
                "reading executable architecture",
            )?;
            ensure_command_success("lipo", "reading executable architecture", &lipo)?;
            let architectures = String::from_utf8_lossy(&lipo.stdout);
            let architectures: Vec<_> = architectures.split_whitespace().collect();
            if architectures.as_slice() != [self.policy.architecture] {
                return Err(SafeInstallError::InvalidBundle(format!(
                    "expected executable architecture {}, got {}",
                    self.policy.architecture,
                    architectures.join(", ")
                )));
            }

            let verification = run_command(
                &self.commands,
                "/usr/bin/codesign",
                &[
                    OsString::from("--verify"),
                    OsString::from("--deep"),
                    OsString::from("--strict"),
                    OsString::from("--verbose=2"),
                    bundle.as_os_str().to_owned(),
                ],
                "verifying the staged application signature",
            )?;
            ensure_command_success(
                "codesign",
                "verifying the staged application signature",
                &verification,
            )?;

            let certificate_dir = tempfile::Builder::new()
                .prefix("aplena-update-certificate-")
                .tempdir()
                .map_err(|source| SafeInstallError::Io {
                    operation: "create certificate verification directory",
                    path: std::env::temp_dir(),
                    source,
                })?;
            let certificate_prefix = certificate_dir.path().join("certificate");
            let extraction = run_command(
                &self.commands,
                "/usr/bin/codesign",
                &[
                    OsString::from("-d"),
                    OsString::from(format!(
                        "--extract-certificates={}",
                        certificate_prefix.display()
                    )),
                    bundle.as_os_str().to_owned(),
                ],
                "extracting the staged signing certificate",
            )?;
            ensure_command_success(
                "codesign",
                "extracting the staged signing certificate",
                &extraction,
            )?;

            let leaf_certificate = certificate_prefix.with_file_name("certificate0");
            ensure_regular_file(&leaf_certificate, "leaf signing certificate")?;
            let mut certificate_bytes = Vec::new();
            fs::File::open(&leaf_certificate)
                .and_then(|mut file| file.read_to_end(&mut certificate_bytes))
                .map_err(|source| SafeInstallError::Io {
                    operation: "read staged signing certificate",
                    path: leaf_certificate,
                    source,
                })?;
            let actual_fingerprint = sha256_hex(&certificate_bytes);
            let expected_fingerprint = normalize_fingerprint(self.policy.certificate_sha256)?;
            if actual_fingerprint != expected_fingerprint {
                return Err(SafeInstallError::CertificateMismatch {
                    expected: expected_fingerprint,
                    actual: actual_fingerprint,
                });
            }

            Ok(())
        }
    }

    fn required_plist_string<'a>(
        dictionary: &'a plist::Dictionary,
        key: &str,
    ) -> Result<&'a str, SafeInstallError> {
        dictionary
            .get(key)
            .and_then(plist::Value::as_string)
            .filter(|value| !value.is_empty())
            .ok_or_else(|| {
                SafeInstallError::InvalidBundle(format!("Info.plist is missing string value {key}"))
            })
    }

    fn ensure_regular_file(path: &Path, description: &str) -> Result<(), SafeInstallError> {
        let metadata = fs::symlink_metadata(path).map_err(|source| SafeInstallError::Io {
            operation: "inspect staged bundle file",
            path: path.to_path_buf(),
            source,
        })?;
        if metadata.file_type().is_symlink() || !metadata.is_file() {
            return Err(SafeInstallError::InvalidBundle(format!(
                "{description} is not a regular file: {}",
                path.display()
            )));
        }
        Ok(())
    }

    fn normalize_fingerprint(value: &str) -> Result<String, SafeInstallError> {
        let normalized: String = value
            .chars()
            .filter(|character| *character != ':')
            .flat_map(char::to_uppercase)
            .collect();
        if normalized.len() != 64
            || !normalized
                .chars()
                .all(|character| character.is_ascii_hexdigit())
        {
            return Err(SafeInstallError::InvalidBundle(
                "configured certificate SHA-256 fingerprint is invalid".to_string(),
            ));
        }
        Ok(normalized)
    }

    fn sha256_hex(bytes: &[u8]) -> String {
        const HEX: &[u8; 16] = b"0123456789ABCDEF";
        Sha256::digest(bytes)
            .iter()
            .flat_map(|byte| {
                [
                    HEX[(byte >> 4) as usize] as char,
                    HEX[(byte & 0x0f) as usize] as char,
                ]
            })
            .collect()
    }

    trait CommandRunner {
        fn run(&self, program: &'static str, arguments: &[OsString]) -> std::io::Result<Output>;
    }

    struct SystemCommandRunner;

    impl CommandRunner for SystemCommandRunner {
        fn run(&self, program: &'static str, arguments: &[OsString]) -> std::io::Result<Output> {
            Command::new(program).args(arguments).output()
        }
    }

    fn run_command<C: CommandRunner>(
        commands: &C,
        program: &'static str,
        arguments: &[OsString],
        operation: &'static str,
    ) -> Result<Output, SafeInstallError> {
        commands
            .run(program, arguments)
            .map_err(|source| SafeInstallError::Io {
                operation,
                path: PathBuf::from(program),
                source,
            })
    }

    fn ensure_command_success(
        program: &'static str,
        operation: &'static str,
        output: &Output,
    ) -> Result<(), SafeInstallError> {
        if output.status.success() {
            Ok(())
        } else {
            Err(SafeInstallError::CommandFailed {
                program,
                operation,
                stderr: String::from_utf8_lossy(&output.stderr).trim().to_string(),
            })
        }
    }

    fn cleanup_backups_for_bundle(installed_bundle: &Path) -> Result<usize, SafeInstallError> {
        let parent = installed_bundle.parent().ok_or_else(|| {
            SafeInstallError::InvalidBundle("installed bundle has no parent".to_string())
        })?;
        let archive_bundle_name = Some(OsStr::new(ARCHIVE_BUNDLE_NAME));
        let entries = fs::read_dir(parent).map_err(|source| SafeInstallError::Io {
            operation: "scan for stale update backups",
            path: parent.to_path_buf(),
            source,
        })?;
        let mut removed = 0usize;

        for entry in entries.flatten() {
            let candidate = entry.path();
            if matches!(
                is_owned_backup_dir(&candidate, parent, archive_bundle_name),
                Ok(true)
            ) && fs::remove_dir_all(&candidate).is_ok()
            {
                removed += 1;
            }
        }
        Ok(removed)
    }

    fn is_owned_backup_dir(
        candidate: &Path,
        expected_parent: &Path,
        bundle_name: Option<&OsStr>,
    ) -> Result<bool, SafeInstallError> {
        if candidate.parent() != Some(expected_parent) {
            return Ok(false);
        }
        let Some(name) = candidate.file_name().and_then(OsStr::to_str) else {
            return Ok(false);
        };
        if !name.starts_with(STAGING_PREFIX) {
            return Ok(false);
        }

        let Ok(metadata) = fs::symlink_metadata(candidate) else {
            return Ok(false);
        };
        if metadata.file_type().is_symlink()
            || !metadata.is_dir()
            || metadata.uid() != unsafe { libc::geteuid() }
        {
            return Ok(false);
        }

        let marker = candidate.join(BACKUP_MARKER);
        let Ok(marker_metadata) = fs::symlink_metadata(&marker) else {
            return Ok(false);
        };
        if marker_metadata.file_type().is_symlink() || !marker_metadata.is_file() {
            return Ok(false);
        }
        let Ok(contents) = fs::read(&marker) else {
            return Ok(false);
        };
        if contents != BACKUP_MARKER_CONTENT {
            return Ok(false);
        }

        // A directory created by this installer contains only the marker and,
        // once extraction begins, the application bundle. This final shape
        // check prevents a broad prefix match from deleting unrelated data.
        let mut saw_marker = false;
        let entries = fs::read_dir(candidate).map_err(|source| SafeInstallError::Io {
            operation: "inspect stale update backup",
            path: candidate.to_path_buf(),
            source,
        })?;
        for entry in entries {
            let Ok(entry) = entry else {
                return Ok(false);
            };
            let name = entry.file_name();
            if name == OsStr::new(BACKUP_MARKER) {
                saw_marker = true;
            } else if bundle_name.is_some_and(|bundle_name| name == bundle_name) {
                // The only non-marker entry produced by the installer is the
                // staged (or, after exchange, retained old) application.
            } else {
                return Ok(false);
            }
        }
        Ok(saw_marker)
    }

    #[cfg(test)]
    mod tests {
        use super::*;
        use flate2::{Compression, write::GzEncoder};
        use std::{
            cell::Cell, collections::BTreeMap, io, os::unix::process::ExitStatusExt,
            process::ExitStatus,
        };

        struct AllowValidator;

        impl BundleValidator for AllowValidator {
            fn validate(&self, _bundle: &Path) -> Result<(), SafeInstallError> {
                Ok(())
            }
        }

        struct RejectValidator;

        impl BundleValidator for RejectValidator {
            fn validate(&self, _bundle: &Path) -> Result<(), SafeInstallError> {
                Err(SafeInstallError::InvalidBundle(
                    "injected validation failure".to_string(),
                ))
            }
        }

        struct FailingSwap {
            kind: io::ErrorKind,
            calls: Cell<usize>,
        }

        impl AtomicSwap for FailingSwap {
            fn exchange(&self, _staged: &Path, _installed: &Path) -> io::Result<()> {
                self.calls.set(self.calls.get() + 1);
                Err(io::Error::new(self.kind, "injected exchange failure"))
            }
        }

        fn create_named_installed_bundle(root: &Path, name: &str, marker: &[u8]) -> PathBuf {
            let bundle = root.join(name);
            fs::create_dir_all(bundle.join("Contents/MacOS")).unwrap();
            fs::write(bundle.join("Contents/MacOS/version-marker"), marker).unwrap();
            bundle
        }

        fn create_installed_bundle(root: &Path, marker: &[u8]) -> PathBuf {
            create_named_installed_bundle(root, ARCHIVE_BUNDLE_NAME, marker)
        }

        fn archive_with_marker(root_name: &str, marker: &[u8]) -> Vec<u8> {
            let source = tempfile::tempdir().unwrap();
            let bundle = source.path().join(root_name);
            fs::create_dir_all(bundle.join("Contents/MacOS")).unwrap();
            fs::write(bundle.join("Contents/MacOS/version-marker"), marker).unwrap();

            let encoder = GzEncoder::new(Vec::new(), Compression::default());
            let mut archive = tar::Builder::new(encoder);
            archive.append_dir_all(root_name, &bundle).unwrap();
            archive.into_inner().unwrap().finish().unwrap()
        }

        fn marker(bundle: &Path) -> Vec<u8> {
            fs::read(bundle.join("Contents/MacOS/version-marker")).unwrap()
        }

        #[test]
        fn atomic_exchange_installs_new_bundle_and_retains_old_bundle() {
            let root = tempfile::tempdir().unwrap();
            let installed = create_installed_bundle(root.path(), b"old");
            let archive = archive_with_marker("Aplena.app", b"new");

            let receipt =
                install_with_components(&archive, &installed, &AllowValidator, &MacAtomicSwap)
                    .unwrap();

            assert_eq!(marker(&installed), b"new");
            assert_eq!(
                marker(&receipt.retained_backup_dir.join("Aplena.app")),
                b"old"
            );
            assert!(receipt.retained_backup_dir.exists());
            fs::remove_dir_all(&receipt.retained_backup_dir).unwrap();
            assert!(!receipt.retained_backup_dir.exists());
            assert_eq!(marker(&installed), b"new");
        }

        #[test]
        fn atomic_exchange_supports_a_user_renamed_installed_bundle() {
            let root = tempfile::tempdir().unwrap();
            let installed = create_named_installed_bundle(root.path(), "家庭财务.app", b"old");
            let archive = archive_with_marker(ARCHIVE_BUNDLE_NAME, b"new");

            let receipt =
                install_with_components(&archive, &installed, &AllowValidator, &MacAtomicSwap)
                    .unwrap();

            assert_eq!(marker(&installed), b"new");
            assert_eq!(
                marker(&receipt.retained_backup_dir.join(ARCHIVE_BUNDLE_NAME)),
                b"old"
            );
            assert_eq!(cleanup_backups_for_bundle(&installed).unwrap(), 1);
            assert!(!receipt.retained_backup_dir.exists());
        }

        #[test]
        fn every_atomic_exchange_failure_leaves_old_bundle_in_place() {
            for kind in [
                io::ErrorKind::PermissionDenied,
                io::ErrorKind::CrossesDevices,
                io::ErrorKind::Unsupported,
                io::ErrorKind::Other,
            ] {
                let root = tempfile::tempdir().unwrap();
                let installed = create_installed_bundle(root.path(), b"old");
                let archive = archive_with_marker("Aplena.app", b"new");
                let swap = FailingSwap {
                    kind,
                    calls: Cell::new(0),
                };

                let error = install_with_components(&archive, &installed, &AllowValidator, &swap)
                    .unwrap_err();

                assert!(matches!(error, SafeInstallError::AtomicExchange(_)));
                assert_eq!(swap.calls.get(), 1);
                assert!(installed.exists());
                assert_eq!(marker(&installed), b"old");
            }
        }

        #[test]
        fn validation_failure_never_attempts_exchange() {
            let root = tempfile::tempdir().unwrap();
            let installed = create_installed_bundle(root.path(), b"old");
            let archive = archive_with_marker("Aplena.app", b"new");
            let swap = FailingSwap {
                kind: io::ErrorKind::Other,
                calls: Cell::new(0),
            };

            let error =
                install_with_components(&archive, &installed, &RejectValidator, &swap).unwrap_err();

            assert!(matches!(error, SafeInstallError::InvalidBundle(_)));
            assert_eq!(swap.calls.get(), 0);
            assert_eq!(marker(&installed), b"old");
        }

        #[test]
        fn archive_with_wrong_root_is_rejected_before_exchange() {
            let root = tempfile::tempdir().unwrap();
            let installed = create_installed_bundle(root.path(), b"old");
            let archive = archive_with_marker("Other.app", b"new");
            let swap = FailingSwap {
                kind: io::ErrorKind::Other,
                calls: Cell::new(0),
            };

            let error =
                install_with_components(&archive, &installed, &AllowValidator, &swap).unwrap_err();

            assert!(matches!(error, SafeInstallError::InvalidArchive(_)));
            assert_eq!(swap.calls.get(), 0);
            assert_eq!(marker(&installed), b"old");
        }

        #[test]
        fn traversal_and_escaping_links_are_rejected() {
            assert!(
                validate_archive_path(
                    Path::new("Aplena.app/Contents/MacOS"),
                    OsStr::new("Aplena.app")
                )
                .is_ok()
            );
            assert!(
                validate_archive_path(Path::new("Aplena.app/../outside"), OsStr::new("Aplena.app"))
                    .is_err()
            );
            assert!(
                validate_archive_path(Path::new("/Aplena.app/Contents"), OsStr::new("Aplena.app"))
                    .is_err()
            );
            assert!(
                validate_symlink_target(
                    Path::new("Aplena.app/Contents/Frameworks/link"),
                    Path::new("../../../../outside")
                )
                .is_err()
            );
            assert!(
                validate_symlink_target(
                    Path::new("Aplena.app/Contents/Frameworks/Foo.framework/Versions/Current"),
                    Path::new("A")
                )
                .is_ok()
            );
        }

        #[derive(Clone)]
        struct FakeCommandRunner {
            architecture: &'static str,
            certificate: Vec<u8>,
            fail_codesign_verification: bool,
        }

        impl CommandRunner for FakeCommandRunner {
            fn run(&self, program: &'static str, arguments: &[OsString]) -> io::Result<Output> {
                if program == "/usr/bin/lipo" {
                    return Ok(output(
                        0,
                        format!("{}\n", self.architecture).as_bytes(),
                        b"",
                    ));
                }

                if arguments
                    .iter()
                    .any(|argument| argument == OsStr::new("--verify"))
                {
                    return Ok(if self.fail_codesign_verification {
                        output(1, b"", b"invalid signature")
                    } else {
                        output(0, b"", b"")
                    });
                }

                let certificate_prefix = arguments
                    .iter()
                    .filter_map(|argument| argument.to_str())
                    .find_map(|argument| argument.strip_prefix("--extract-certificates="))
                    .expect("certificate extraction argument");
                fs::write(format!("{certificate_prefix}0"), &self.certificate).unwrap();
                Ok(output(0, b"", b""))
            }
        }

        fn output(code: i32, stdout: &[u8], stderr: &[u8]) -> Output {
            Output {
                status: ExitStatus::from_raw(code),
                stdout: stdout.to_vec(),
                stderr: stderr.to_vec(),
            }
        }

        fn create_validatable_bundle(root: &Path, version: &str) -> PathBuf {
            let bundle = root.join("Aplena.app");
            fs::create_dir_all(bundle.join("Contents/MacOS")).unwrap();
            fs::write(bundle.join("Contents/MacOS/aplena"), b"fake macho").unwrap();
            let mut info = BTreeMap::new();
            info.insert(
                "CFBundleIdentifier".to_string(),
                plist::Value::String(APLENA_BUNDLE_IDENTIFIER.to_string()),
            );
            info.insert(
                "CFBundleShortVersionString".to_string(),
                plist::Value::String(version.to_string()),
            );
            info.insert(
                "CFBundleExecutable".to_string(),
                plist::Value::String("aplena".to_string()),
            );
            plist::to_file_xml(
                bundle.join("Contents/Info.plist"),
                &plist::Value::Dictionary(info.into_iter().collect()),
            )
            .unwrap();
            bundle
        }

        #[test]
        fn validates_metadata_architecture_codesign_and_leaf_certificate() {
            let root = tempfile::tempdir().unwrap();
            let bundle = create_validatable_bundle(root.path(), "1.2.0");
            let certificate = b"test leaf certificate".to_vec();
            let fingerprint = sha256_hex(&certificate);
            let validator = MacBundleValidator {
                policy: ValidationPolicy {
                    bundle_identifier: APLENA_BUNDLE_IDENTIFIER,
                    version: "1.2.0",
                    architecture: "arm64",
                    certificate_sha256: &fingerprint,
                },
                commands: FakeCommandRunner {
                    architecture: "arm64",
                    certificate,
                    fail_codesign_verification: false,
                },
            };

            validator.validate(&bundle).unwrap();
        }

        #[test]
        fn rejects_version_architecture_codesign_and_certificate_mismatches() {
            let cases = [
                ("9.9.9", "arm64", false, false),
                ("1.2.0", "x86_64", false, false),
                ("1.2.0", "arm64", true, false),
                ("1.2.0", "arm64", false, true),
            ];
            for (expected_version, actual_architecture, fail_codesign, wrong_certificate) in cases {
                let root = tempfile::tempdir().unwrap();
                let bundle = create_validatable_bundle(root.path(), "1.2.0");
                let certificate = b"test leaf certificate".to_vec();
                let fingerprint = if wrong_certificate {
                    sha256_hex(b"another certificate")
                } else {
                    sha256_hex(&certificate)
                };
                let validator = MacBundleValidator {
                    policy: ValidationPolicy {
                        bundle_identifier: APLENA_BUNDLE_IDENTIFIER,
                        version: expected_version,
                        architecture: "arm64",
                        certificate_sha256: &fingerprint,
                    },
                    commands: FakeCommandRunner {
                        architecture: actual_architecture,
                        certificate,
                        fail_codesign_verification: fail_codesign,
                    },
                };

                assert!(validator.validate(&bundle).is_err());
            }
        }

        #[test]
        fn stale_cleanup_only_removes_owned_marked_directories() {
            let root = tempfile::tempdir().unwrap();
            let installed = create_installed_bundle(root.path(), b"current");
            let owned = root.path().join(format!("{STAGING_PREFIX}owned"));
            fs::create_dir_all(owned.join("Aplena.app")).unwrap();
            write_backup_marker(&owned).unwrap();
            let unmarked = root.path().join(format!("{STAGING_PREFIX}unmarked"));
            fs::create_dir_all(unmarked.join("Aplena.app")).unwrap();
            let unrelated = root.path().join("user-data");
            fs::create_dir_all(&unrelated).unwrap();

            assert_eq!(cleanup_backups_for_bundle(&installed).unwrap(), 1);
            assert!(!owned.exists());
            assert!(unmarked.exists());
            assert!(unrelated.exists());
            assert!(installed.exists());
        }
    }
}
