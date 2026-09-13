import { createWriteStream, mkdirSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { dirname, join, posix } from "node:path";
import { deflateRawSync } from "node:zlib";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const manifest = JSON.parse(readFileSync(join(root, "manifest.json"), "utf8"));
const version = manifest.version;

if (process.argv.includes("--check-tag")) {
  const tag = (process.env.GITHUB_REF_NAME || "").replace(/^v/, "");
  if (!tag) {
    throw new Error("GITHUB_REF_NAME is missing.");
  }
  if (tag !== version) {
    throw new Error(`Tag v${tag} does not match manifest version ${version}.`);
  }
}

const files = [
  "manifest.json",
  "LICENSE",
  "PRIVACY.md",
  "README.md",
  ...listFiles("src", (name) => !name.startsWith(".")),
  ...listFiles("icons", (name) => /^icon\d+\.png$/i.test(name)),
];

const outDir = join(root, "dist");
const zipName = `bookmark-search-plus-${version}.zip`;
const zipPath = join(outDir, zipName);
mkdirSync(outDir, { recursive: true });
rmSync(zipPath, { force: true });
await writeZip(
  zipPath,
  files.map((rel) => ({ rel, abs: join(root, rel) }))
);
console.log(zipPath);

function listFiles(dir, keep) {
  return readdirSync(join(root, dir))
    .filter(keep)
    .map((name) => posix.join(dir, name))
    .filter((rel) => statSync(join(root, rel)).isFile())
    .sort();
}

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function dosDateTime(date) {
  const dosTime = (date.getSeconds() >> 1) | (date.getMinutes() << 5) | (date.getHours() << 11);
  const dosDate = date.getDate() | ((date.getMonth() + 1) << 5) | ((date.getFullYear() - 1980) << 9);
  return { dosTime, dosDate };
}

function writeTo(stream, buffer) {
  return new Promise((resolve, reject) => {
    stream.write(buffer, (error) => (error ? reject(error) : resolve()));
  });
}

async function writeZip(outPath, entries) {
  const output = createWriteStream(outPath);
  const central = [];
  let offset = 0;

  for (const { rel, abs } of entries) {
    const uncompressed = readFileSync(abs);
    const compressed = deflateRawSync(uncompressed);
    const { dosTime, dosDate } = dosDateTime(statSync(abs).mtime);
    const name = Buffer.from(rel.split("\\").join("/"), "utf8");
    const crc = crc32(uncompressed);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(8, 8);
    local.writeUInt16LE(dosTime, 10);
    local.writeUInt16LE(dosDate, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(uncompressed.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    await writeTo(output, local);
    await writeTo(output, name);
    await writeTo(output, compressed);
    const dir = Buffer.alloc(46);
    dir.writeUInt32LE(0x02014b50, 0);
    dir.writeUInt16LE(20, 4);
    dir.writeUInt16LE(20, 6);
    dir.writeUInt16LE(0, 8);
    dir.writeUInt16LE(8, 10);
    dir.writeUInt16LE(dosTime, 12);
    dir.writeUInt16LE(dosDate, 14);
    dir.writeUInt32LE(crc, 16);
    dir.writeUInt32LE(compressed.length, 20);
    dir.writeUInt32LE(uncompressed.length, 24);
    dir.writeUInt16LE(name.length, 28);
    dir.writeUInt16LE(0, 30);
    dir.writeUInt16LE(0, 32);
    dir.writeUInt16LE(0, 34);
    dir.writeUInt16LE(0, 36);
    dir.writeUInt32LE(0, 38);
    dir.writeUInt32LE(offset, 42);
    central.push(Buffer.concat([dir, name]));
    offset += local.length + name.length + compressed.length;
  }

  const directory = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(central.length, 8);
  end.writeUInt16LE(central.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);
  await writeTo(output, directory);
  await new Promise((resolve, reject) => {
    output.end(end, (error) => (error ? reject(error) : resolve()));
  });
}
