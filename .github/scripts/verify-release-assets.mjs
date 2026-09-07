import fs from "node:fs";
import path from "node:path";
import {
  RELEASE_REPOSITORY,
  validateLocalReleaseDirectory,
  validateRemoteRelease,
  validateRemoteReleaseMetadata,
} from "./release-artifacts.mjs";

function readOptions(arguments_) {
  const options = {};
  for (let index = 0; index < arguments_.length; index += 2) {
    const key = arguments_[index];
    const value = arguments_[index + 1];
    if (!key?.startsWith("--") || value === undefined) {
      throw new Error(`Invalid command argument: ${key ?? "<missing>"}`);
    }
    options[key.slice(2)] = value;
  }
  return options;
}

const options = readOptions(process.argv.slice(2));
const common = {
  version: options.version,
  tag: options.tag,
  repository: options.repository ?? RELEASE_REPOSITORY,
};

if (options.mode === "local") {
  validateLocalReleaseDirectory({
    ...common,
    directory: path.resolve(options["release-dir"]),
    includeManifest: options["include-manifest"] === "true",
  });
  console.log("Local release asset set is complete and internally consistent");
} else if (options.mode === "metadata") {
  validateRemoteReleaseMetadata({
    ...common,
    release: JSON.parse(fs.readFileSync(path.resolve(options["release-json"]), "utf8")),
    localDirectory: path.resolve(options["local-dir"]),
    expectDraft: options["expect-draft"] === "true",
  });
  console.log("Remote release metadata has the exact locally verified asset set and digests");
} else if (options.mode === "remote") {
  validateRemoteRelease({
    ...common,
    release: JSON.parse(fs.readFileSync(path.resolve(options["release-json"]), "utf8")),
    localDirectory: path.resolve(options["local-dir"]),
    downloadedDirectory: path.resolve(options["download-dir"]),
    expectDraft: options["expect-draft"] === "true",
  });
  console.log("Remote release assets match the locally verified release byte for byte");
} else {
  throw new Error(`Unsupported verification mode: ${options.mode ?? "<missing>"}`);
}
