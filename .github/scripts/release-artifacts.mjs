import fs from "node:fs";
import path from "node:path";
import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";

export const STRICT_SEMVER_PATTERN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
export const RELEASE_REPOSITORY = "Morton-Li/Aplena";
export const RELEASE_UPDATER_ENDPOINT =
  "https://github.com/Morton-Li/Aplena/releases/latest/download/latest.json";

const ARCHITECTURES = [
  { artifact: "arm64", platform: "darwin-aarch64" },
  { artifact: "x86_64", platform: "darwin-x86_64" },
];

function fail(message) {
  throw new Error(message);
}

export function assertReleaseIdentity({ version, tag, repository = RELEASE_REPOSITORY }) {
  if (!STRICT_SEMVER_PATTERN.test(version ?? "")) {
    fail(`Invalid release version: ${version ?? "<missing>"}`);
  }
  if (tag !== `v${version}`) {
    fail(`Release tag ${tag ?? "<missing>"} does not match version ${version}`);
  }
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository ?? "")) {
    fail(`Invalid GitHub repository: ${repository ?? "<missing>"}`);
  }
}

export function validateUpdaterPublicKey(value) {
  if (
    typeof value !== "string" ||
    value.length < 80 ||
    value === "APLENA_UPDATER_PUBLIC_KEY_REQUIRED"
  ) {
    fail("APLENA_UPDATER_PUBLIC_KEY is missing or still uses the release-blocking placeholder");
  }

  const decoded = Buffer.from(value, "base64");
  if (decoded.toString("base64") !== value) {
    fail("APLENA_UPDATER_PUBLIC_KEY must be canonical base64");
  }
  const lines = decoded.toString("utf8").trimEnd().split("\n");
  if (lines.length !== 2 || !lines[0].startsWith("untrusted comment: minisign public key:")) {
    fail("APLENA_UPDATER_PUBLIC_KEY does not contain a minisign public key file");
  }
  const keyBytes = Buffer.from(lines[1], "base64");
  if (
    keyBytes.length !== 42 ||
    keyBytes[0] !== "E".charCodeAt(0) ||
    keyBytes[1] !== "d".charCodeAt(0)
  ) {
    fail("APLENA_UPDATER_PUBLIC_KEY contains an invalid minisign key payload");
  }
}

export function buildTauriReleaseConfig(baseConfig, publicKey) {
  validateUpdaterPublicKey(publicKey);
  if (
    !baseConfig ||
    typeof baseConfig !== "object" ||
    Array.isArray(baseConfig) ||
    baseConfig.bundle?.createUpdaterArtifacts !== true
  ) {
    fail("The release config must enable updater artifact generation");
  }
  return {
    ...baseConfig,
    plugins: {
      updater: {
        pubkey: publicKey,
        endpoints: [RELEASE_UPDATER_ENDPOINT],
      },
    },
  };
}

export function releaseAssetMap(tag) {
  const version = tag?.startsWith("v") ? tag.slice(1) : undefined;
  assertReleaseIdentity({ version, tag });

  return Object.fromEntries(
    ARCHITECTURES.map(({ artifact, platform }) => {
      const prefix = `Aplena-${tag}-macos-${artifact}`;
      return [
        platform,
        {
          artifact,
          platform,
          dmg: `${prefix}.dmg`,
          updater: `${prefix}.app.tar.gz`,
          signature: `${prefix}.app.tar.gz.sig`,
        },
      ];
    }),
  );
}

export function expectedBinaryAssetNames(tag) {
  return Object.values(releaseAssetMap(tag)).flatMap(({ dmg, updater, signature }) => [
    dmg,
    updater,
    signature,
  ]);
}

export function expectedPublishedAssetNames(tag) {
  return [...expectedBinaryAssetNames(tag), "latest.json"];
}

export function listRegularFiles(directory) {
  return fs
    .readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
    .sort();
}

export function assertExactFileSet(directory, expectedNames) {
  const actual = listRegularFiles(directory);
  const expected = [...expectedNames].sort();
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    fail(
      `Unexpected release file set in ${directory}. Expected ${expected.join(", ")}; found ${actual.join(", ")}`,
    );
  }
}

export function sha256File(filePath) {
  return createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

export function fileEvidence(directory, names) {
  return Object.fromEntries(
    names.map((name) => {
      const filePath = path.join(directory, name);
      const stats = fs.statSync(filePath);
      if (!stats.isFile() || stats.size <= 0) {
        fail(`Release asset must be a non-empty regular file: ${filePath}`);
      }
      return [name, { size: stats.size, sha256: sha256File(filePath) }];
    }),
  );
}

export function normalizePublicationDate(value) {
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/.test(value)
  ) {
    fail(`Invalid RFC 3339 publication date: ${value ?? "<missing>"}`);
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.valueOf())) {
    fail(`Invalid RFC 3339 publication date: ${value}`);
  }
  return parsed.toISOString();
}

export function buildUpdaterManifest({
  version,
  tag,
  repository = RELEASE_REPOSITORY,
  notes = "",
  publicationDate,
  signatures,
  sizes,
}) {
  assertReleaseIdentity({ version, tag, repository });
  if (typeof notes !== "string") {
    fail("Release notes must be a string");
  }

  const assets = releaseAssetMap(tag);
  const platforms = {};
  for (const { platform, updater, signature } of Object.values(assets)) {
    const signatureContent = signatures?.[platform];
    const size = sizes?.[platform];
    if (
      typeof signatureContent !== "string" ||
      signatureContent.trim().length === 0 ||
      signatureContent.includes("\0")
    ) {
      fail(`Missing or invalid updater signature for ${platform}`);
    }
    if (!Number.isSafeInteger(size) || size <= 0) {
      fail(`Missing or invalid updater size for ${platform}`);
    }
    platforms[platform] = {
      signature: signatureContent,
      size,
      url: `https://github.com/${repository}/releases/download/${tag}/${updater}`,
    };
    if (!signature.endsWith(".sig")) {
      fail(`Invalid updater signature asset name for ${platform}`);
    }
  }

  return {
    version,
    notes,
    pub_date: normalizePublicationDate(publicationDate),
    platforms,
  };
}

function assertExactKeys(value, expected, label) {
  const actual = Object.keys(value ?? {}).sort();
  const sortedExpected = [...expected].sort();
  if (JSON.stringify(actual) !== JSON.stringify(sortedExpected)) {
    fail(`${label} keys must be exactly: ${sortedExpected.join(", ")}`);
  }
}

export function validateUpdaterManifest(
  manifest,
  { version, tag, repository = RELEASE_REPOSITORY, signatures, sizes },
) {
  assertReleaseIdentity({ version, tag, repository });
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) {
    fail("Updater manifest must be an object");
  }
  assertExactKeys(manifest, ["version", "notes", "pub_date", "platforms"], "Manifest");
  if (manifest.version !== version || typeof manifest.notes !== "string") {
    fail("Updater manifest version or notes is invalid");
  }
  normalizePublicationDate(manifest.pub_date);

  const assets = releaseAssetMap(tag);
  assertExactKeys(manifest.platforms, Object.keys(assets), "Manifest platform");
  for (const { platform, updater } of Object.values(assets)) {
    const entry = manifest.platforms[platform];
    assertExactKeys(entry, ["signature", "size", "url"], `Manifest ${platform}`);
    const expectedUrl = `https://github.com/${repository}/releases/download/${tag}/${updater}`;
    if (entry.url !== expectedUrl) {
      fail(`Unexpected updater URL for ${platform}: ${entry.url}`);
    }
    if (entry.signature !== signatures[platform]) {
      fail(`Updater signature mismatch for ${platform}`);
    }
    if (entry.size !== sizes[platform]) {
      fail(`Updater size mismatch for ${platform}`);
    }
  }
}

export function readSignatures(directory, tag) {
  return Object.fromEntries(
    Object.values(releaseAssetMap(tag)).map(({ platform, signature }) => [
      platform,
      fs.readFileSync(path.join(directory, signature), "utf8"),
    ]),
  );
}

export function readUpdaterSizes(directory, tag) {
  return Object.fromEntries(
    Object.values(releaseAssetMap(tag)).map(({ platform, updater }) => {
      const size = fs.statSync(path.join(directory, updater)).size;
      if (!Number.isSafeInteger(size) || size <= 0) {
        fail(`Updater archive must be a non-empty regular file for ${platform}`);
      }
      return [platform, size];
    }),
  );
}

export function validateLocalReleaseDirectory({
  directory,
  version,
  tag,
  repository = RELEASE_REPOSITORY,
  includeManifest,
}) {
  assertReleaseIdentity({ version, tag, repository });
  const names = includeManifest
    ? expectedPublishedAssetNames(tag)
    : expectedBinaryAssetNames(tag);
  assertExactFileSet(directory, names);
  const evidence = fileEvidence(directory, names);

  if (includeManifest) {
    const signatures = readSignatures(directory, tag);
    const sizes = readUpdaterSizes(directory, tag);
    const manifest = JSON.parse(fs.readFileSync(path.join(directory, "latest.json"), "utf8"));
    validateUpdaterManifest(manifest, { version, tag, repository, signatures, sizes });
  }
  return evidence;
}

export function validateRemoteReleaseMetadata({
  release,
  localDirectory,
  version,
  tag,
  repository = RELEASE_REPOSITORY,
  expectDraft,
}) {
  assertReleaseIdentity({ version, tag, repository });
  if (!release || typeof release !== "object" || Array.isArray(release)) {
    fail("GitHub release metadata must be an object");
  }
  if (release.tag_name !== tag || release.prerelease !== false || release.draft !== expectDraft) {
    fail("GitHub release tag, draft, or prerelease state is invalid");
  }

  const expectedNames = expectedPublishedAssetNames(tag);
  const localEvidence = validateLocalReleaseDirectory({
    directory: localDirectory,
    version,
    tag,
    repository,
    includeManifest: true,
  });

  if (!Array.isArray(release.assets)) {
    fail("GitHub release assets must be an array");
  }
  const remoteNames = release.assets.map((asset) => asset.name).sort();
  if (JSON.stringify(remoteNames) !== JSON.stringify([...expectedNames].sort())) {
    fail(`Unexpected remote release asset set: ${remoteNames.join(", ")}`);
  }

  const uniqueNames = new Set(remoteNames);
  if (uniqueNames.size !== remoteNames.length) {
    fail("Remote release asset names must be unique");
  }

  for (const asset of release.assets) {
    const expected = localEvidence[asset.name];
    if (
      asset.state !== "uploaded" ||
      asset.size !== expected.size ||
      asset.digest !== `sha256:${expected.sha256}`
    ) {
      fail(`Remote release evidence mismatch for ${asset.name}`);
    }
  }
  return localEvidence;
}

export function validateRemoteRelease({
  release,
  localDirectory,
  downloadedDirectory,
  version,
  tag,
  repository = RELEASE_REPOSITORY,
  expectDraft,
}) {
  const localEvidence = validateRemoteReleaseMetadata({
    release,
    localDirectory,
    version,
    tag,
    repository,
    expectDraft,
  });
  const expectedNames = expectedPublishedAssetNames(tag);
  assertExactFileSet(downloadedDirectory, expectedNames);
  const downloadedEvidence = validateLocalReleaseDirectory({
    directory: downloadedDirectory,
    version,
    tag,
    repository,
    includeManifest: true,
  });
  for (const name of expectedNames) {
    if (downloadedEvidence[name].sha256 !== localEvidence[name].sha256) {
      fail(`Downloaded release asset differs from local evidence: ${name}`);
    }
  }
}

export function deterministicJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}
