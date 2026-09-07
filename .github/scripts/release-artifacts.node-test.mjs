import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  assertReleaseIdentity,
  buildTauriReleaseConfig,
  buildUpdaterManifest,
  deterministicJson,
  expectedBinaryAssetNames,
  expectedPublishedAssetNames,
  readSignatures,
  readUpdaterSizes,
  releaseAssetMap,
  sha256File,
  validateLocalReleaseDirectory,
  validateRemoteRelease,
  validateUpdaterPublicKey,
  validateUpdaterManifest,
} from "./release-artifacts.mjs";

const VERSION = "2.3.4";
const TAG = `v${VERSION}`;
const PUBLICATION_DATE = "2026-09-07T12:34:56+08:00";

function temporaryDirectory() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "aplena-release-script-test-"));
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function writeBinaryAssets(directory) {
  fs.mkdirSync(directory, { recursive: true });
  for (const name of expectedBinaryAssetNames(TAG)) {
    fs.writeFileSync(path.join(directory, name), `fixture:${name}\n`);
  }
}

function writeCompleteRelease(directory) {
  writeBinaryAssets(directory);
  const signatures = readSignatures(directory, TAG);
  const sizes = readUpdaterSizes(directory, TAG);
  const manifest = buildUpdaterManifest({
    version: VERSION,
    tag: TAG,
    publicationDate: PUBLICATION_DATE,
    notes: "Release notes\n",
    signatures,
    sizes,
  });
  fs.writeFileSync(path.join(directory, "latest.json"), deterministicJson(manifest));
  return manifest;
}

function releaseMetadata(directory, overrides = {}) {
  return {
    tag_name: TAG,
    draft: true,
    prerelease: false,
    assets: expectedPublishedAssetNames(TAG).map((name, index) => ({
      id: index + 1,
      name,
      state: "uploaded",
      size: fs.statSync(path.join(directory, name)).size,
      digest: `sha256:${sha256File(path.join(directory, name))}`,
      url: `https://api.github.com/repos/Morton-Li/Aplena/releases/assets/${index + 1}`,
    })),
    ...overrides,
  };
}

test("release identity accepts only matching strict stable SemVer tags", () => {
  assert.doesNotThrow(() => assertReleaseIdentity({ version: VERSION, tag: TAG }));
  for (const [version, tag] of [
    ["2.3.4-rc.1", "v2.3.4-rc.1"],
    ["02.3.4", "v02.3.4"],
    ["2.3", "v2.3"],
    ["2.3.4", "2.3.4"],
    ["2.3.4", "v2.3.5"],
  ]) {
    assert.throws(() => assertReleaseIdentity({ version, tag }));
  }
});

test("release public key gate accepts a complete minisign envelope and rejects placeholders", () => {
  const keyPayload = Buffer.concat([Buffer.from("Ed"), Buffer.alloc(40, 7)]).toString("base64");
  const encodedPublicKey = Buffer.from(
    `untrusted comment: minisign public key: 0707070707070707\n${keyPayload}\n`,
  ).toString("base64");
  assert.doesNotThrow(() => validateUpdaterPublicKey(encodedPublicKey));
  assert.throws(() => validateUpdaterPublicKey("APLENA_UPDATER_PUBLIC_KEY_REQUIRED"));
  assert.throws(() => validateUpdaterPublicKey("not-a-key"));

  const releaseConfig = buildTauriReleaseConfig(
    { bundle: { createUpdaterArtifacts: true } },
    encodedPublicKey,
  );
  assert.equal(releaseConfig.plugins.updater.pubkey, encodedPublicKey);
  assert.deepEqual(releaseConfig.plugins.updater.endpoints, [
    "https://github.com/Morton-Li/Aplena/releases/latest/download/latest.json",
  ]);
  assert.throws(() => buildTauriReleaseConfig({ bundle: {} }, encodedPublicKey));
});

test("manifest is deterministic and maps both architectures to immutable tag URLs", () => {
  const directory = temporaryDirectory();
  try {
    writeBinaryAssets(directory);
    const signatures = readSignatures(directory, TAG);
    const sizes = readUpdaterSizes(directory, TAG);
    const first = buildUpdaterManifest({
      version: VERSION,
      tag: TAG,
      notes: "Notes",
      publicationDate: PUBLICATION_DATE,
      signatures,
      sizes,
    });
    const second = buildUpdaterManifest({
      version: VERSION,
      tag: TAG,
      notes: "Notes",
      publicationDate: PUBLICATION_DATE,
      signatures,
      sizes,
    });

    assert.equal(deterministicJson(first), deterministicJson(second));
    assert.equal(first.pub_date, "2026-09-07T04:34:56.000Z");
    assert.deepEqual(Object.keys(first.platforms), ["darwin-aarch64", "darwin-x86_64"]);
    for (const { platform, updater } of Object.values(releaseAssetMap(TAG))) {
      assert.equal(
        first.platforms[platform].url,
        `https://github.com/Morton-Li/Aplena/releases/download/${TAG}/${updater}`,
      );
      assert.equal(first.platforms[platform].signature, signatures[platform]);
      assert.equal(first.platforms[platform].size, sizes[platform]);
    }
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("manifest validation rejects missing platforms, mutable URLs, and signature drift", () => {
  const directory = temporaryDirectory();
  try {
    const manifest = writeCompleteRelease(directory);
    const signatures = readSignatures(directory, TAG);
    const sizes = readUpdaterSizes(directory, TAG);
    assert.doesNotThrow(() =>
      validateUpdaterManifest(manifest, { version: VERSION, tag: TAG, signatures, sizes }),
    );

    const missingPlatform = clone(manifest);
    delete missingPlatform.platforms["darwin-x86_64"];
    assert.throws(() =>
      validateUpdaterManifest(missingPlatform, { version: VERSION, tag: TAG, signatures, sizes }),
    );

    const mutableUrl = clone(manifest);
    mutableUrl.platforms["darwin-aarch64"].url =
      "https://github.com/Morton-Li/Aplena/releases/latest/download/update.tar.gz";
    assert.throws(() =>
      validateUpdaterManifest(mutableUrl, { version: VERSION, tag: TAG, signatures, sizes }),
    );

    const driftedSignature = clone(manifest);
    driftedSignature.platforms["darwin-x86_64"].signature = "different";
    assert.throws(() =>
      validateUpdaterManifest(driftedSignature, { version: VERSION, tag: TAG, signatures, sizes }),
    );

    const driftedSize = clone(manifest);
    driftedSize.platforms["darwin-aarch64"].size += 1;
    assert.throws(() =>
      validateUpdaterManifest(driftedSize, { version: VERSION, tag: TAG, signatures, sizes }),
    );
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("local verification requires an exact non-empty asset set", () => {
  const directory = temporaryDirectory();
  try {
    writeCompleteRelease(directory);
    assert.doesNotThrow(() =>
      validateLocalReleaseDirectory({
        directory,
        version: VERSION,
        tag: TAG,
        includeManifest: true,
      }),
    );

    fs.writeFileSync(path.join(directory, "unexpected.txt"), "unexpected");
    assert.throws(() =>
      validateLocalReleaseDirectory({
        directory,
        version: VERSION,
        tag: TAG,
        includeManifest: true,
      }),
    );
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("remote verification binds API metadata and downloaded bytes to local evidence", () => {
  const localDirectory = temporaryDirectory();
  const downloadedDirectory = temporaryDirectory();
  try {
    writeCompleteRelease(localDirectory);
    fs.cpSync(localDirectory, downloadedDirectory, { recursive: true });
    const release = releaseMetadata(localDirectory);
    assert.doesNotThrow(() =>
      validateRemoteRelease({
        release,
        localDirectory,
        downloadedDirectory,
        version: VERSION,
        tag: TAG,
        expectDraft: true,
      }),
    );

    const wrongDigest = clone(release);
    wrongDigest.assets[0].digest = `sha256:${"0".repeat(64)}`;
    assert.throws(() =>
      validateRemoteRelease({
        release: wrongDigest,
        localDirectory,
        downloadedDirectory,
        version: VERSION,
        tag: TAG,
        expectDraft: true,
      }),
    );

    fs.appendFileSync(path.join(downloadedDirectory, expectedPublishedAssetNames(TAG)[0]), "tampered");
    assert.throws(() =>
      validateRemoteRelease({
        release,
        localDirectory,
        downloadedDirectory,
        version: VERSION,
        tag: TAG,
        expectDraft: true,
      }),
    );
  } finally {
    fs.rmSync(localDirectory, { recursive: true, force: true });
    fs.rmSync(downloadedDirectory, { recursive: true, force: true });
  }
});
