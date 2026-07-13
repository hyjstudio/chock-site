import assert from "node:assert/strict";
import { stat } from "node:fs/promises";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

const [manifest, index, appcast, redirects, headers, notFound] = await Promise.all([
  read("release-manifest.json").then(JSON.parse),
  read("index.html"),
  read("appcast.xml"),
  read("_redirects"),
  read("_headers"),
  read("404.html")
]);

const current = manifest.current;
const next = manifest.next;

test("current release metadata is consistent across published surfaces", async () => {
  assert.equal(current.status, "published");
  assert.equal(current.version, "0.4.2");

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
  assert.match(firstItem, new RegExp(`sparkle:shortVersionString>${escapeRegExp(current.version)}<`));
  assert.match(firstItem, new RegExp(`url="https://getchock.com${escapeRegExp(current.zip.path)}"`));
  assert.match(firstItem, new RegExp(`length="${current.zip.size}"`));
  assert.match(firstItem, /sparkle:edSignature="[^"]+"/);

  assert.equal((await stat(new URL(`../.${current.dmg.path}`, import.meta.url))).size, current.dmg.size);
  assert.equal((await stat(new URL(`../.${current.zip.path}`, import.meta.url))).size, current.zip.size);
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

  const releaseFiles = (await Promise.all(["0.4.0", "0.4.1", "0.4.2"].flatMap((version) => [
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

test("0.4.3 remains an unpublished skeleton with no invented release facts", () => {
  assert.equal(next.version, "0.4.3");
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

  for (const surface of [index, appcast, redirects, headers]) {
    assert.doesNotMatch(surface, /0\.4\.3/);
  }
});

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
