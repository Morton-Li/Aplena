import fs from "node:fs";
import path from "node:path";

import {
  buildTauriReleaseConfig,
  deterministicJson,
  validateUpdaterPublicKey,
} from "./release-artifacts.mjs";

const publicKey = process.env.APLENA_UPDATER_PUBLIC_KEY;
validateUpdaterPublicKey(publicKey);

const writeIndex = process.argv.indexOf("--write-config");
if (writeIndex >= 0) {
  const output = process.argv[writeIndex + 1];
  if (!output || process.argv.length !== writeIndex + 2) {
    throw new Error("--write-config requires exactly one output path");
  }
  const baseConfig = JSON.parse(
    fs.readFileSync(path.resolve("src-tauri/tauri.release.conf.json"), "utf8"),
  );
  fs.writeFileSync(
    path.resolve(output),
    deterministicJson(buildTauriReleaseConfig(baseConfig, publicKey)),
  );
}

console.log("Updater public key is present and has a valid minisign public-key envelope");
