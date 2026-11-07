import { execFileSync } from "node:child_process";

function git(args) {
  return execFileSync("git", args, { encoding: "utf8" }).trim();
}

export function previousReleaseTag(current = "") {
  const tags = git(["tag", "-l", "v*", "--sort=-v:refname"])
    .split("\n")
    .map((tag) => tag.trim())
    .filter(Boolean);
  return tags.find((tag) => tag !== current) || "";
}

export function buildReleaseNotes(tag = "", toRef = "HEAD") {
  const prev = previousReleaseTag(tag);
  const range = prev ? `${prev}..${toRef}` : toRef;
  let log = "";
  try {
    log = git(["log", "--no-merges", "--pretty=format:%s", range]);
  } catch {
    log = git(["log", "--no-merges", "--pretty=format:%s", "-30"]);
  }
  const items = log
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !/^chore: release v\d/i.test(line))
    .map((line) => `- ${line}`);
  const changes = items.length ? items.join("\n") : "- See the repository history for this release.";
  const title = tag ? `Bookmark Search Plus ${tag}` : "Changes";
  const compare = prev && tag ? `\n\nCompare: ${prev}...${tag}` : "";
  return `## ${title}\n\n${changes}${compare}\n`;
}

const invoked = process.argv[1]?.replaceAll("\\", "/").endsWith("scripts/changelog.mjs");
if (invoked) {
  const tag = process.argv[2] || "";
  const toRef = process.argv[3] || tag || "HEAD";
  process.stdout.write(buildReleaseNotes(tag, toRef));
}
