import { execFileSync } from "node:child_process";
import { readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildReleaseNotes } from "./changelog.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
process.chdir(root);

const manifestPath = join(root, "manifest.json");
const packagePath = join(root, "package.json");
const readmePath = join(root, "README.md");
const versionLine = /Confirm the version is \*\*(\d+\.\d+\.\d+)\*\*/;

function fail(message) {
  console.error(message);
  process.exit(1);
}

// This machine's SSH handshake to github.com is refused before the key is
// signed, and url.insteadOf rewrites https://github.com/ back to that SSH
// remote. Talk to GitHub over HTTPS with the gh credential the script already
// requires. An empty credential.helper drops any helper that would pop a prompt.
let githubAuthArgs;
function authArgs() {
  if (githubAuthArgs) {
    return githubAuthArgs;
  }
  let owner = "trasherdk";
  try {
    const url = execFileSync("git", ["remote", "get-url", "origin"], { encoding: "utf8" }).trim();
    const match = /^git@github\.com:([^/]+)\//.exec(url);
    if (match) {
      owner = match[1];
    }
  } catch {
    // origin is git@github.com:<owner>/... when the remote can be read
  }
  githubAuthArgs = [
    "-c",
    "url.https://github.com/.insteadOf=https://github.com/",
    "-c",
    `url.https://github.com/${owner}/.insteadOf=git@github.com:${owner}/`,
    "-c",
    "credential.helper=",
    "-c",
    "credential.https://github.com.helper=!gh auth git-credential",
  ];
  return githubAuthArgs;
}

function gitEnv(opts = {}) {
  const { env, ...rest } = opts;
  return {
    ...rest,
    env: { ...process.env, GIT_TERMINAL_PROMPT: "0", ...env },
  };
}

function git(args, opts = {}) {
  return execFileSync("git", [...authArgs(), ...args], { encoding: "utf8", ...gitEnv(opts) }).trim();
}

function gitRun(args) {
  execFileSync("git", [...authArgs(), ...args], { stdio: "inherit", ...gitEnv() });
}

function gh(args, opts = {}) {
  return execFileSync("gh", args, { encoding: "utf8", ...opts }).trim();
}

function isAncestor(maybeAncestor, rev) {
  try {
    git(["merge-base", "--is-ancestor", maybeAncestor, rev]);
    return true;
  } catch {
    return false;
  }
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function parseVersion(version) {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);
  if (!match) {
    fail(`Version "${version}" is not X.Y.Z. Chrome extension versions cannot use a beta or rc suffix.`);
  }
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

function formatVersion(parts) {
  return parts.join(".");
}

export function plannedVersion(version, bumpArg) {
  const parts = parseVersion(version);
  if (!bumpArg) {
    return formatVersion(parts);
  }
  return formatVersion(bumped(parts, bumpArg));
}

function bumped(parts, kind) {
  if (kind === "major") {
    return [parts[0] + 1, 0, 0];
  }
  if (kind === "minor") {
    return [parts[0], parts[1] + 1, 0];
  }
  if (kind === "patch") {
    return [parts[0], parts[1], parts[2] + 1];
  }
  fail(`Unknown bump "${kind}". Use patch, minor, or major.`);
}

function readArgs() {
  let bump = null;
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--") {
      continue;
    }
    if (arg === "--bump") {
      bump = argv[++i];
      if (!["patch", "minor", "major"].includes(bump)) {
        fail(`Unknown bump "${bump ?? ""}". Use patch, minor, or major.`);
      }
      continue;
    }
    fail(`Unknown argument "${arg}". Use --bump patch, minor, or major.`);
  }
  return bump;
}

function currentVersion() {
  const manifest = readJson(manifestPath).version;
  const pkg = readJson(packagePath).version;
  const readme = versionLine.exec(readFileSync(readmePath, "utf8"));
  if (!readme) {
    fail("README install step has no version line to update.");
  }
  if (manifest !== pkg || manifest !== readme[1]) {
    fail(`Versions disagree: manifest.json ${manifest}, package.json ${pkg}, README ${readme[1]}.`);
  }
  return manifest;
}

function writeVersion(version) {
  const manifest = readJson(manifestPath);
  manifest.version = version;
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

  const pkg = readJson(packagePath);
  pkg.version = version;
  writeFileSync(packagePath, `${JSON.stringify(pkg, null, 2)}\n`);

  const readme = readFileSync(readmePath, "utf8");
  const next = readme.replace(versionLine, `Confirm the version is **${version}**`);
  if (next === readme) {
    fail("README install step has no version line to update.");
  }
  writeFileSync(readmePath, next);
}

function main() {
  const bumpArg = readArgs();

  const branch = git(["branch", "--show-current"]);
  if (branch !== "develop") {
    fail(`Release from develop only (current branch: ${branch}).`);
  }

  const dirty = git(["status", "--porcelain"]);
  if (dirty) {
    fail("Working tree is not clean. Commit or stash first.");
  }

  try {
    gh(["auth", "status"]);
  } catch {
    fail("gh is not authenticated. Run: gh auth login");
  }

  gitRun(["fetch", "origin", "--prune", "--tags"]);

  const head = git(["rev-parse", "HEAD"]);
  const remoteDevelop = git(["rev-parse", "origin/develop"]);
  if (head !== remoteDevelop) {
    const ahead = git(["rev-list", "--count", "origin/develop..HEAD"]);
    const behind = git(["rev-list", "--count", "HEAD..origin/develop"]);
    fail(`develop is not synced with origin/develop (ahead ${ahead}, behind ${behind}).`);
  }

  if (!isAncestor("origin/master", "HEAD")) {
    console.log("Merging origin/master into develop so develop continues from master");
    gitRun(["merge", "origin/master", "-m", "Merge origin/master into develop"]);
    gitRun(["push", "origin", "HEAD"]);
  }

  const version = plannedVersion(currentVersion(), bumpArg);
  if (version !== currentVersion()) {
    writeVersion(version);
    git(["add", "manifest.json", "package.json", "README.md"]);
    gitRun(["commit", "-m", `chore: release v${version}`]);
    gitRun(["push", "origin", "HEAD"]);
  }

  const tag = `v${version}`;
  const existing = git(["ls-remote", "--tags", "origin", tag]);
  if (existing) {
    fail(`Tag ${tag} already exists on origin.`);
  }

  if (!isAncestor("origin/master", "HEAD")) {
    fail("develop is still not a continuation of origin/master after merge.");
  }

  const changes = buildReleaseNotes(tag, "HEAD");
  const title = `Release ${tag}`;
  const body = [
    changes.trim(),
    "",
    "## Release mechanics",
    `- Promote \`develop\` to \`master\` for **${tag}**.`,
    "- After merge, `develop` is fast-forwarded to `master` so both point at the same commit.",
    `- GitHub Actions packages bookmark-search-plus-${version}.zip and publishes the GitHub Release.`,
  ].join("\n");

  const masterTip = git(["rev-parse", "origin/master"]);
  if (masterTip === git(["rev-parse", "HEAD"])) {
    console.log(`develop and master are already ${masterTip}. Skipping the pull request.`);
  } else {
    let pr = "";
    try {
      pr = gh(["pr", "list", "--base", "master", "--head", "develop", "--json", "url", "--jq", ".[0].url"]);
    } catch {
      pr = "";
    }

    if (!pr || pr === "null") {
      pr = gh(["pr", "create", "--base", "master", "--head", "develop", "--title", title, "--body", body]);
      console.log(`Opened ${pr}`);
    } else {
      console.log(`Using existing PR ${pr}`);
    }

    const notesFile = join(tmpdir(), `bookmark-search-plus-${tag}-merge.txt`);
    writeFileSync(notesFile, `${changes.trim()}\n`);
    try {
      execFileSync(
        "gh",
        ["pr", "merge", pr, "--merge", "--delete-branch=false", "--subject", `Release ${tag}`, "--body-file", notesFile],
        { stdio: "inherit" }
      );
    } finally {
      try {
        unlinkSync(notesFile);
      } catch {
        // The temp file only carries the merge message.
      }
    }
  }

  gitRun(["fetch", "origin", "master", "develop", "--tags"]);

  const originMaster = git(["rev-parse", "origin/master"]);
  if (git(["rev-parse", "HEAD"]) !== originMaster) {
    gitRun(["merge", "--ff-only", "origin/master"]);
    gitRun(["push", "origin", "HEAD:develop"]);
  }

  try {
    git(["branch", "-f", "master", "origin/master"]);
  } catch {
    // local master may not exist
  }

  gitRun(["fetch", "origin", "master", "develop"]);
  const tip = git(["rev-parse", "HEAD"]);
  const finalMaster = git(["rev-parse", "origin/master"]);
  const finalDevelop = git(["rev-parse", "origin/develop"]);
  if (tip !== finalMaster || tip !== finalDevelop) {
    fail(
      `develop and master are not the same after release (HEAD ${tip}, origin/master ${finalMaster}, origin/develop ${finalDevelop}).`
    );
  }

  let tagged = "";
  try {
    tagged = git(["rev-parse", `${tag}^{}`]);
  } catch {
    tagged = "";
  }
  if (!tagged) {
    gitRun(["tag", "-a", tag, tip, "-m", tag]);
  } else if (tagged !== tip) {
    fail(`Local tag ${tag} points at ${tagged}, not ${tip}.`);
  }
  gitRun(["push", "origin", tag]);

  console.log(`Tagged ${tag} at ${tip}`);
  console.log(`origin/master and origin/develop are ${tip}`);
  console.log(`Release: https://github.com/trasherdk/bookmark-search-plus/releases/tag/${tag}`);
  console.log(
    "GitHub Actions publishes the GitHub Release and the extension zip. Do not create the release locally — a published empty release blocks the zip upload."
  );
}

const invoked = process.argv[1]?.replaceAll("\\", "/").endsWith("scripts/release.mjs");
if (invoked) {
  main();
}
