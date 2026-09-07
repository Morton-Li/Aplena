import fs from "node:fs";
import path from "node:path";
import {
  buildUpdaterManifest,
  deterministicJson,
  readSignatures,
  readUpdaterSizes,
  validateLocalReleaseDirectory,
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
const releaseDirectory = path.resolve(options["release-dir"] ?? "release");
const output = path.resolve(options.output ?? path.join(releaseDirectory, "latest.json"));

validateLocalReleaseDirectory({
  directory: releaseDirectory,
  version: options.version,
  tag: options.tag,
  repository: options.repository,
  includeManifest: false,
});

const manifest = buildUpdaterManifest({
  version: options.version,
  tag: options.tag,
  repository: options.repository,
  notes: fs.readFileSync(path.resolve(options["notes-file"]), "utf8"),
  publicationDate: options["pub-date"],
  signatures: readSignatures(releaseDirectory, options.tag),
  sizes: readUpdaterSizes(releaseDirectory, options.tag),
});

fs.writeFileSync(output, deterministicJson(manifest));
console.log(`Generated deterministic updater manifest at ${output}`);
