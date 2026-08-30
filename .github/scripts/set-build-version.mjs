import fs from "node:fs";

const version = process.argv[2];
const semverPattern = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

if (!version || !semverPattern.test(version)) {
  console.error(`Invalid build version: ${version ?? "<missing>"}`);
  process.exit(1);
}

function updateJson(path) {
  const document = JSON.parse(fs.readFileSync(path, "utf8"));
  document.version = version;
  fs.writeFileSync(path, `${JSON.stringify(document, null, 2)}\n`);
}

function replaceExactlyOnce(path, pattern, replacement) {
  const source = fs.readFileSync(path, "utf8");
  const matches = source.match(pattern);
  if (!matches || matches.length !== 1) {
    throw new Error(`Expected exactly one version entry in ${path}`);
  }
  fs.writeFileSync(path, source.replace(pattern, replacement));
}

function readExactlyOnce(path, pattern) {
  const source = fs.readFileSync(path, "utf8");
  const matches = [...source.matchAll(pattern)];
  if (matches.length !== 1 || !matches[0][1]) {
    throw new Error(`Expected exactly one readable version entry in ${path}`);
  }
  return matches[0][1];
}

updateJson("package.json");
updateJson("src-tauri/tauri.conf.json");
replaceExactlyOnce(
  "Cargo.toml",
  /(?<=\[workspace\.package\]\n)version = "[^"]+"/g,
  `version = "${version}"`,
);
for (const packageName of ["aplena", "pfcm-domain"]) {
  replaceExactlyOnce(
    "Cargo.lock",
    new RegExp(`(?<=\\[\\[package\\]\\]\\nname = "${packageName}"\\n)version = "[^"]+"`, "g"),
    `version = "${version}"`,
  );
}

for (const manifest of ["src-tauri/Cargo.toml", "crates/pfcm-domain/Cargo.toml"]) {
  const source = fs.readFileSync(manifest, "utf8");
  if (!/^version\.workspace = true$/m.test(source)) {
    throw new Error(`Expected ${manifest} to inherit workspace.package.version`);
  }
}

const writtenVersions = [
  JSON.parse(fs.readFileSync("package.json", "utf8")).version,
  JSON.parse(fs.readFileSync("src-tauri/tauri.conf.json", "utf8")).version,
  readExactlyOnce("Cargo.toml", /(?<=\[workspace\.package\]\n)version = "([^"]+)"/g),
  ...["aplena", "pfcm-domain"].map((packageName) => readExactlyOnce(
    "Cargo.lock",
    new RegExp(`(?<=\\[\\[package\\]\\]\\nname = "${packageName}"\\n)version = "([^"]+)"`, "g"),
  )),
];

if (writtenVersions.some((writtenVersion) => writtenVersion !== version)) {
  throw new Error(`Build version synchronization failed: ${writtenVersions.join(", ")}`);
}

console.log(`Synchronized build version ${version}`);
