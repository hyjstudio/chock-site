import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

const [manifest, index, appcast, redirects, headers, notFound, changelog] = await Promise.all([
  read("release-manifest.json").then(JSON.parse),
  read("index.html"),
  read("appcast.xml"),
  read("_redirects"),
  read("_headers"),
  read("404.html"),
  read("changelog.html")
]);

const current = manifest.current;
const next = manifest.next;
const releaseNotes = await read(`notes/Chock-${current.version}.html`);

test("current release metadata is consistent across published surfaces", async () => {
  assert.equal(current.status, "published");
  assert.equal(current.version, "0.4.3");
  assert.equal(current.releaseDate, "2026-07-13");
  assert.equal(current.sparkleVersion, 257);

  const jsonLdMatch = index.match(/<script type="application\/ld\+json">\s*([\s\S]*?)\s*<\/script>/);
  assert.ok(jsonLdMatch, "index.html must include JSON-LD metadata");
  const jsonLd = JSON.parse(jsonLdMatch[1]);

  assert.equal(jsonLd.softwareVersion, current.version);
  assert.equal(jsonLd.downloadUrl, `https://getchock.com${current.dmg.path}`);
  assert.equal(jsonLd.fileSize, current.displaySize.replace(" ", ""));
  assert.match(index, new RegExp(`id="dlBtn" href="${escapeRegExp(current.dmg.path)}"`));
  assert.match(index, new RegExp(`DMG_URL = new URL\\("${escapeRegExp(current.dmg.path)}"`));
  assert.match(index, new RegExp(`下载 Chock ${escapeRegExp(current.version)}`));

  const firstItem = appcast.match(/<item>([\s\S]*?)<\/item>/)?.[1];
  assert.ok(firstItem, "appcast.xml must contain a current item");
  assert.match(firstItem, new RegExp(`<title>${escapeRegExp(current.version)}</title>`));
  assert.match(firstItem, new RegExp(`<sparkle:version>${current.sparkleVersion}</sparkle:version>`));
  assert.match(firstItem, new RegExp(`sparkle:shortVersionString>${escapeRegExp(current.version)}<`));
  assert.match(firstItem, new RegExp(`url="https://getchock.com${escapeRegExp(current.zip.path)}"`));
  assert.match(firstItem, new RegExp(`length="${current.zip.size}"`));
  assert.match(firstItem, new RegExp(`sparkle:edSignature="${escapeRegExp(current.zip.sparkleEdSignature)}"`));
  assert.match(appcast, /<channel>\s*<title>Chock<\/title>/);

  const dmgURL = new URL(`../.${current.dmg.path}`, import.meta.url);
  const zipURL = new URL(`../.${current.zip.path}`, import.meta.url);
  assert.equal((await stat(dmgURL)).size, current.dmg.size);
  assert.equal((await stat(zipURL)).size, current.zip.size);
  assert.equal(await sha256(dmgURL), current.dmg.sha256);
  assert.equal(await sha256(zipURL), current.zip.sha256);

  for (const surface of [changelog, releaseNotes]) {
    assert.match(surface, /0\.4\.3/);
    assert.match(surface, /截图保留按键瞬间的画面/);
    assert.match(surface, /截图反馈更干净/);
    assert.match(surface, /一次 macOS 原生截图音效/);
    assert.match(surface, /内存管理可以安全退出应用/);
  }
});

test("legacy aliases redirect only to the current immutable assets", () => {
  const rules = new Map(
    redirects
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#"))
      .map((line) => {
        const [source, destination, status = "302"] = line.split(/\s+/);
        return [source, { destination, status }];
      })
  );

  for (const source of ["/dl", "/dl/", "/dl/Chock.dmg"]) {
    assert.deepEqual(rules.get(source), { destination: current.dmg.path, status: "302" });
  }
  assert.deepEqual(rules.get("/dl/Chock.zip"), { destination: current.zip.path, status: "302" });
});

test("only known release assets receive binary response headers", async () => {
  assert.doesNotMatch(headers, /^\/dl\/\*/m, "wildcard download headers would mislabel 404 responses");

  const releaseFiles = (await Promise.all(["0.4.0", "0.4.1", "0.4.2", "0.4.3"].flatMap((version) => [
    stat(new URL(`../dl/Chock-${version}.dmg`, import.meta.url)).then(() => `/dl/Chock-${version}.dmg`),
    stat(new URL(`../dl/Chock-${version}.zip`, import.meta.url)).then(() => `/dl/Chock-${version}.zip`)
  ])));

  for (const path of releaseFiles) {
    assert.match(headers, new RegExp(`^${escapeRegExp(path)}$`, "m"));
    assert.match(headers, new RegExp(`filename="${escapeRegExp(path.split("/").at(-1))}"`));
  }

  assert.match(notFound, /404 · NOT FOUND/);
  assert.match(notFound, /明确返回 404/);
});

test("0.4.4 remains an unpublished skeleton with no invented release facts", () => {
  assert.equal(next.version, "0.4.4");
  assert.equal(next.status, "draft");

  for (const value of [
    next.releaseDate,
    next.sparkleVersion,
    next.displaySize,
    next.dmg.path,
    next.dmg.size,
    next.dmg.sha256,
    next.zip.path,
    next.zip.size,
    next.zip.sha256,
    next.zip.sparkleEdSignature,
    next.releaseNotesPath
  ]) {
    assert.equal(value, null);
  }

  for (const surface of [index, appcast, redirects, headers, changelog]) {
    assert.doesNotMatch(surface, /0\.4\.4/);
  }
});

async function sha256(url) {
  return createHash("sha256").update(await readFile(url)).digest("hex");
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
