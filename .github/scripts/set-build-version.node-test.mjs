import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { synchronizeBuildVersion } from "./set-build-version.mjs";

function createFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "aplena-build-version-test-"));
  fs.mkdirSync(path.join(root, "src-tauri"), { recursive: true });
  fs.mkdirSync(path.join(root, "crates/pfcm-domain"), { recursive: true });
  fs.writeFileSync(path.join(root, "package.json"), '{"name":"aplena","version":"0.1.0"}\n');
  fs.writeFileSync(
    path.join(root, "src-tauri/tauri.conf.json"),
    '{"productName":"Aplena","version":"0.1.0"}\n',
  );
  fs.writeFileSync(
    path.join(root, "Cargo.toml"),
    '[workspace]\nmembers = []\n\n[workspace.package]\nversion = "0.1.0"\n',
  );
  fs.writeFileSync(
    path.join(root, "Cargo.lock"),
    '[[package]]\nname = "aplena"\nversion = "0.1.0"\n\n[[package]]\nname = "pfcm-domain"\nversion = "0.1.0"\n',
  );
  fs.writeFileSync(path.join(root, "src-tauri/Cargo.toml"), '[package]\nversion.workspace = true\n');
  fs.writeFileSync(
    path.join(root, "crates/pfcm-domain/Cargo.toml"),
    '[package]\nversion.workspace = true\n',
  );
  return root;
}

function fixtureDigest(root) {
  const hash = createHash("sha256");
  for (const relativePath of [
    "package.json",
    "src-tauri/tauri.conf.json",
    "Cargo.toml",
    "Cargo.lock",
    "src-tauri/Cargo.toml",
    "crates/pfcm-domain/Cargo.toml",
  ]) {
    hash.update(relativePath);
    hash.update(fs.readFileSync(path.join(root, relativePath)));
  }
  return hash.digest("hex");
}

test("synchronizes every build version location", () => {
  const root = createFixture();
  try {
    assert.deepEqual(synchronizeBuildVersion("2.3.4", root), Array(5).fill("2.3.4"));
    assert.equal(JSON.parse(fs.readFileSync(path.join(root, "package.json"))).version, "2.3.4");
    assert.equal(
      JSON.parse(fs.readFileSync(path.join(root, "src-tauri/tauri.conf.json"))).version,
      "2.3.4",
    );
    assert.match(fs.readFileSync(path.join(root, "Cargo.toml"), "utf8"), /version = "2\.3\.4"/);
    assert.equal(
      [...fs.readFileSync(path.join(root, "Cargo.lock"), "utf8").matchAll(/version = "2\.3\.4"/g)]
        .length,
      2,
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("rejects invalid versions before changing the fixture", () => {
  for (const version of ["v2.3.4", "2.3", "02.3.4", "2.3.4-rc.1"]) {
    const root = createFixture();
    try {
      const before = fixtureDigest(root);
      assert.throws(() => synchronizeBuildVersion(version, root));
      assert.equal(fixtureDigest(root), before);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  }
});

test("validates all source structure before writing any file", () => {
  const root = createFixture();
  try {
    fs.writeFileSync(path.join(root, "crates/pfcm-domain/Cargo.toml"), '[package]\nversion = "0.1.0"\n');
    const before = fixtureDigest(root);
    assert.throws(() => synchronizeBuildVersion("2.3.4", root), /inherit/);
    assert.equal(fixtureDigest(root), before);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
