import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const BUILD_VERSION_PATTERN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

function replaceExactlyOnce(source, pattern, replacement, label) {
  const matches = source.match(pattern);
  if (!matches || matches.length !== 1) {
    throw new Error(`Expected exactly one version entry in ${label}`);
  }
  return source.replace(pattern, replacement);
}

function readExactlyOnce(source, pattern, label) {
  const matches = [...source.matchAll(pattern)];
  if (matches.length !== 1 || !matches[0][1]) {
    throw new Error(`Expected exactly one readable version entry in ${label}`);
  }
  return matches[0][1];
}

export function synchronizeBuildVersion(version, root = process.cwd()) {
  if (!version || !BUILD_VERSION_PATTERN.test(version)) {
    throw new Error(`Invalid build version: ${version ?? "<missing>"}`);
  }

  const paths = {
    packageJson: path.join(root, "package.json"),
    tauriConfig: path.join(root, "src-tauri/tauri.conf.json"),
    workspaceManifest: path.join(root, "Cargo.toml"),
    lockfile: path.join(root, "Cargo.lock"),
    appManifest: path.join(root, "src-tauri/Cargo.toml"),
    domainManifest: path.join(root, "crates/pfcm-domain/Cargo.toml"),
  };

  const packageDocument = JSON.parse(fs.readFileSync(paths.packageJson, "utf8"));
  const tauriDocument = JSON.parse(fs.readFileSync(paths.tauriConfig, "utf8"));
  const workspaceSource = fs.readFileSync(paths.workspaceManifest, "utf8");
  const lockfileSource = fs.readFileSync(paths.lockfile, "utf8");

  for (const manifestPath of [paths.appManifest, paths.domainManifest]) {
    const source = fs.readFileSync(manifestPath, "utf8");
    if (!/^version\.workspace = true$/m.test(source)) {
      throw new Error(`Expected ${path.relative(root, manifestPath)} to inherit workspace.package.version`);
    }
  }

  packageDocument.version = version;
  tauriDocument.version = version;
  const nextWorkspaceSource = replaceExactlyOnce(
    workspaceSource,
    /(?<=\[workspace\.package\]\n)version = "[^"]+"/g,
    `version = "${version}"`,
    "Cargo.toml",
  );
  let nextLockfileSource = lockfileSource;
  for (const packageName of ["aplena", "pfcm-domain"]) {
    nextLockfileSource = replaceExactlyOnce(
      nextLockfileSource,
      new RegExp(`(?<=\\[\\[package\\]\\]\\nname = "${packageName}"\\n)version = "[^"]+"`, "g"),
      `version = "${version}"`,
      `Cargo.lock package ${packageName}`,
    );
  }

  const plannedWrites = new Map([
    [paths.packageJson, `${JSON.stringify(packageDocument, null, 2)}\n`],
    [paths.tauriConfig, `${JSON.stringify(tauriDocument, null, 2)}\n`],
    [paths.workspaceManifest, nextWorkspaceSource],
    [paths.lockfile, nextLockfileSource],
  ]);

  const plannedVersions = [
    packageDocument.version,
    tauriDocument.version,
    readExactlyOnce(
      nextWorkspaceSource,
      /(?<=\[workspace\.package\]\n)version = "([^"]+)"/g,
      "Cargo.toml",
    ),
    ...["aplena", "pfcm-domain"].map((packageName) =>
      readExactlyOnce(
        nextLockfileSource,
        new RegExp(
          `(?<=\\[\\[package\\]\\]\\nname = "${packageName}"\\n)version = "([^"]+)"`,
          "g",
        ),
        `Cargo.lock package ${packageName}`,
      ),
    ),
  ];
  if (plannedVersions.some((plannedVersion) => plannedVersion !== version)) {
    throw new Error(`Build version synchronization plan failed: ${plannedVersions.join(", ")}`);
  }

  for (const [filePath, content] of plannedWrites) {
    fs.writeFileSync(filePath, content);
  }
  return plannedVersions;
}

const scriptPath = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === scriptPath) {
  try {
    const version = process.argv[2];
    synchronizeBuildVersion(version);
    console.log(`Synchronized build version ${version}`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
