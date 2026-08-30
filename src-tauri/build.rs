fn main() {
    // Tauri embeds frontend files at compile time. Track the production bundle explicitly so an
    // incremental release build cannot reuse a previous UI asset map after `pnpm build` runs.
    println!("cargo:rerun-if-changed=../dist");
    tauri_build::build()
}
