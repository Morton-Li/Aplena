use std::{env, fs, path::Path};

use base64::{Engine as _, engine::general_purpose::STANDARD};
use minisign_verify::{PublicKey, Signature};

fn decode_envelope(value: &str, label: &str) -> Result<String, String> {
    let bytes = STANDARD
        .decode(value.trim())
        .map_err(|_| format!("{label} is not valid base64"))?;
    String::from_utf8(bytes).map_err(|_| format!("{label} is not valid UTF-8"))
}

fn verify(
    archive_path: &Path,
    signature_path: &Path,
    encoded_public_key: &str,
) -> Result<(), String> {
    let archive = fs::read(archive_path).map_err(|_| "cannot read updater archive".to_owned())?;
    let encoded_signature = fs::read_to_string(signature_path)
        .map_err(|_| "cannot read updater signature".to_owned())?;
    let public_key = PublicKey::decode(&decode_envelope(encoded_public_key, "updater public key")?)
        .map_err(|_| "updater public key envelope is invalid".to_owned())?;
    let signature = Signature::decode(&decode_envelope(&encoded_signature, "updater signature")?)
        .map_err(|_| "updater signature envelope is invalid".to_owned())?;
    public_key
        .verify(&archive, &signature, true)
        .map_err(|_| "updater archive signature verification failed".to_owned())
}

fn main() {
    let mut arguments = env::args_os().skip(1);
    let archive = arguments.next().unwrap_or_else(|| {
        eprintln!("usage: verify_updater_signature <archive> <signature>");
        std::process::exit(2);
    });
    let signature = arguments.next().unwrap_or_else(|| {
        eprintln!("usage: verify_updater_signature <archive> <signature>");
        std::process::exit(2);
    });
    if arguments.next().is_some() {
        eprintln!("usage: verify_updater_signature <archive> <signature>");
        std::process::exit(2);
    }
    let public_key = env::var("APLENA_UPDATER_PUBLIC_KEY").unwrap_or_else(|_| {
        eprintln!("APLENA_UPDATER_PUBLIC_KEY is required");
        std::process::exit(2);
    });

    if let Err(error) = verify(Path::new(&archive), Path::new(&signature), &public_key) {
        eprintln!("{error}");
        std::process::exit(1);
    }
    println!("Updater archive signature is valid");
}

#[cfg(test)]
mod tests {
    use super::verify;
    use std::{fs, path::Path};

    const PUBLIC_KEY: &str = "dW50cnVzdGVkIGNvbW1lbnQ6IG1pbmlzaWduIHB1YmxpYyBrZXk6IDMwQzk1QUFGNzBDQkMyMjkKUldRcHdzdHdyMXJKTURKQUdudE95VlZnQldiMFpvWW9hV0RqT1pTSVFDSVliODJtb0t3MVhxS2kK";
    const SIGNATURE: &str = "dW50cnVzdGVkIGNvbW1lbnQ6IHNpZ25hdHVyZSBmcm9tIHRhdXJpIHNlY3JldCBrZXkKUlVRcHdzdHdyMXJKTUc0b0NRZEQ4cGhrTi8xWTdLdTFjaUYxWUtkaDM2SDM3TFR6Ulp6ODlRemRJQk5ESTIrYlVmWTBjN00rVVlwSlRuVEpNRXE1aHoyZG16V3VDa0l4NlFJPQp0cnVzdGVkIGNvbW1lbnQ6IHRpbWVzdGFtcDoxNzg4NzkwNjU2CWZpbGU6cGF5bG9hZC5iaW4KZXU4bDc4ME1ZZUpHNVpKWXk2ckMrT1N2aTdSMWliTjlWbTEwK2NCb1FNR0VZOGhiaUMxMTk4TmNCc3VHSVE3Tjl4c3VxMWI2bTY0SEZlYUJOelpJQWc9PQo=";

    #[test]
    fn accepts_matching_bytes_and_rejects_tampering() {
        let directory = tempfile::tempdir().expect("signature fixture directory");
        let archive = directory.path().join("update.tar.gz");
        let signature = directory.path().join("update.tar.gz.sig");
        fs::write(&archive, b"verified-updater-fixture\n").expect("write archive fixture");
        fs::write(&signature, SIGNATURE).expect("write signature fixture");

        assert!(verify(&archive, &signature, PUBLIC_KEY).is_ok());
        fs::write(&archive, b"tampered-updater-fixture\n").expect("tamper archive fixture");
        assert!(verify(&archive, &signature, PUBLIC_KEY).is_err());
        assert!(verify(Path::new("missing"), &signature, PUBLIC_KEY).is_err());
    }
}
