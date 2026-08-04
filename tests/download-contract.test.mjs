import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, readdir, stat } from "node:fs/promises";
import test from "node:test";
import { renderRegionalAppcast } from "../scripts/render-regional-appcast.mjs";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

const [manifest, index, appcast, redirects, headers, notFound, changelog, sitemap] = await Promise.all([
  read("release-manifest.json").then(JSON.parse),
  read("index.html"),
  read("appcast.xml"),
  read("_redirects"),
  read("_headers"),
  read("404.html"),
  read("changelog.html"),
  read("sitemap.xml")
]);

const current = manifest.current;
const next = manifest.next;
const releaseNotes = await read(`notes/Chock-${current.version}.html`);
const noteNames = (await readdir(new URL("../notes/", import.meta.url)))
  .filter((name) => /^Chock-\d+\.\d+\.\d+\.html$/.test(name));
const allReleaseNotes = await Promise.all(noteNames.map((name) => read(`notes/${name}`)));
const releaseNotesPolicy = await read("docs/public-release-notes-policy.md");

test("current release metadata is consistent across published surfaces", async () => {
  assert.equal(current.status, "published");
  assert.equal(current.version, "0.5.7");
  assert.equal(current.releaseDate, "2026-08-04");
  assert.equal(current.sparkleVersion, 457);
  assert.equal(current.dmg.size, 4858432);
  assert.equal(current.dmg.sha256, "e5b67b22c51c749f8db35e198a5057021d6a86724076a99886492e6b2c5964a7");
  assert.equal(current.zip.size, 4435313);
  assert.equal(current.zip.sha256, "396c5b7ae567e5e1d6d95d1dbdfdb147355241b2d1b9ad9b19d24cf2c4e27510");
  assert.equal(current.zip.sparkleEdSignature, "CSt4IOSQTd3D0xQROQQ/iXRZ2jWODI7gP/HynY8yohaGcZVhzPzeB7fxOKZ/0tEx/6BH+hgmHSLfWhYAJs59AA==");

  const jsonLdMatch = index.match(/<script type="application\/ld\+json">\s*([\s\S]*?)\s*<\/script>/);
  assert.ok(jsonLdMatch, "index.html must include JSON-LD metadata");
  const jsonLd = JSON.parse(jsonLdMatch[1]);

  assert.equal(jsonLd.softwareVersion, current.version);
  assert.equal(jsonLd.downloadUrl, `https://getchock.com${current.dmg.path}`);
  assert.equal(jsonLd.fileSize, current.displaySize.replace(" ", ""));
  assert.deepEqual(jsonLd.offers, {
    "@type": "Offer",
    price: "9.90",
    priceCurrency: "CNY",
    url: "https://pay.getchock.cn/buy",
    availability: "https://schema.org/InStock"
  });
  assert.match(index, new RegExp(`id="dlBtn" href="${escapeRegExp(current.dmg.path)}"`));
  assert.match(index, new RegExp(`DMG_URL = new URL\\("${escapeRegExp(current.dmg.path)}"`));
  assert.match(index, new RegExp(`下载 Chock ${escapeRegExp(current.version)}`));
  assert.match(extractSection("download"), new RegExp(`Build ${current.sparkleVersion}`));

  const firstItem = appcast.match(/<item>([\s\S]*?)<\/item>/)?.[1];
  assert.ok(firstItem, "appcast.xml must contain a current item");
  assert.match(firstItem, new RegExp(`<title>${escapeRegExp(current.version)}</title>`));
  assert.match(firstItem, new RegExp(`<sparkle:version>${current.sparkleVersion}</sparkle:version>`));
  assert.match(firstItem, new RegExp(`sparkle:shortVersionString>${escapeRegExp(current.version)}<`));
  assert.match(firstItem, new RegExp(`url="https://getchock.com${escapeRegExp(current.zip.path)}"`));
  assert.match(firstItem, new RegExp(`length="${current.zip.size}"`));
  assert.match(firstItem, new RegExp(`sparkle:edSignature="${escapeRegExp(current.zip.sparkleEdSignature)}"`));
  assert.match(firstItem, /<sparkle:minimumSystemVersion>14\.0<\/sparkle:minimumSystemVersion>/);
  assert.match(firstItem, /<sparkle:hardwareRequirements>arm64<\/sparkle:hardwareRequirements>/);
  assert.match(firstItem, new RegExp(`<sparkle:releaseNotesLink>https://getchock.com${escapeRegExp(current.releaseNotesPath)}</sparkle:releaseNotesLink>`));
  assert.match(appcast, /<channel>\s*<title>Chock<\/title>/);
  assert.match(sitemap, new RegExp(`<lastmod>${escapeRegExp(current.releaseDate)}</lastmod>`));

  const dmgURL = new URL(`../.${current.dmg.path}`, import.meta.url);
  const zipURL = new URL(`../.${current.zip.path}`, import.meta.url);
  assert.equal((await stat(dmgURL)).size, current.dmg.size);
  assert.equal((await stat(zipURL)).size, current.zip.size);
  assert.equal(await sha256(dmgURL), current.dmg.sha256);
  assert.equal(await sha256(zipURL), current.zip.sha256);

  const currentChangelog = changelog.match(/<section class="rel"><h2>0\.5\.7[\s\S]*?<\/section>/)?.[0];
  assert.ok(currentChangelog, "changelog must include the 0.5.7 section");
  assert.match(currentChangelog, /<p class="feat"><strong>做了些许优化。<\/strong><\/p>/);
  assert.doesNotMatch(currentChangelog, /<ul>|Codex 额度刷新更稳|最近一次有效额度|从 8 秒放宽到 15 秒/);

  const releaseNotesBody = releaseNotes.match(/<body>([\s\S]*?)<\/body>/)?.[1];
  assert.ok(releaseNotesBody, "release notes must have a body");
  assert.equal(
    releaseNotesBody.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim(),
    "楔子 0.5.7 2026-08-04 做了些许优化。"
  );
});

test("mainland appcast is a deterministic authority-only derivative", () => {
  const mainlandAppcast = renderRegionalAppcast(appcast, "https://getchock.cn");
  const firstItem = mainlandAppcast.match(/<item>([\s\S]*?)<\/item>/)?.[1];

  assert.ok(firstItem, "mainland appcast must contain a current item");
  assert.match(firstItem, new RegExp(`url="https://getchock.cn${escapeRegExp(current.zip.path)}"`));
  assert.match(firstItem, new RegExp(`<sparkle:releaseNotesLink>https://getchock.cn${escapeRegExp(current.releaseNotesPath)}</sparkle:releaseNotesLink>`));
  assert.match(firstItem, new RegExp(`sparkle:edSignature="${escapeRegExp(current.zip.sparkleEdSignature)}"`));
  assert.doesNotMatch(mainlandAppcast, /https:\/\/getchock\.com\//);
  assert.equal(mainlandAppcast.replaceAll("https://getchock.cn/", "https://getchock.com/"), appcast);
});

test("homepage stats keep two centered user-facing cards", () => {
  const numbers = extractSection("numbers");

  assert.equal((numbers.match(/class="stat reveal"/g) ?? []).length, 2);
  assert.doesNotMatch(numbers, /data-count="1065"|自动化测试/);
  assert.match(index, /\.stats\{display:grid;grid-template-columns:repeat\(2,minmax\(0,1fr\)\);max-width:720px;/);
  assert.match(index, /\.stats\{grid-template-columns:1fr;max-width:540px\}/);
});

test("homepage sends mainland visitors to the Shanghai site", () => {
  assert.match(index, /href="https:\/\/getchock\.cn"[^>]*>getchock\.cn<\/a>/);
  assert.doesNotMatch(index, /cn\.getchock\.com/);
});

test("homepage explains the full trial and permanent license before purchase", () => {
  const hero = extractSection("top");
  const license = extractSection("license");
  const download = extractSection("download");

  assert.match(hero, /免费试用 7 天/);
  assert.match(hero, /¥9\.9 永久授权/);
  assert.match(license, /7 天完整试用/);
  assert.match(license, /第一次真正使用楔子功能时/);
  assert.match(license, /¥9\.9/);
  assert.match(license, /没有订阅/);
  assert.match(license, /不需要注册账号/);
  assert.match(license, /异步确认通知/);
  assert.match(download, /第一次真正使用功能时，自动开始 7 天完整试用/);
  assert.equal((index.match(/href="https:\/\/pay\.getchock\.cn\/buy"/g) ?? []).length, 2);
  assert.doesNotMatch(index, /pay\.getchock\.com/);
});

test("homepage first-run proof uses the current seven-step onboarding capture", async () => {
  const proof = extractSection("productproof");

  assert.match(proof, /七步引导/);
  assert.match(proof, /src="\/onboarding-invocation@2x\.png" width="1120" height="1104"/);
  assert.match(proof, /alt="楔子七步新手引导的第 2 步：/);
  assert.doesNotMatch(proof, /settings-invocation@2x\.png|五步/);
  assert.doesNotMatch(index, /五步/);

  const capture = await readFile(new URL("../onboarding-invocation@2x.png", import.meta.url));
  assert.equal(capture.readUInt32BE(16), 1120);
  assert.equal(capture.readUInt32BE(20), 1104);
  assert.ok((await stat(new URL("../settings-invocation@2x.png", import.meta.url))).isFile());
});

test("public release notes stay user-facing without hiding material risk", () => {
  const publicSurfaces = [changelog, ...allReleaseNotes];
  const internalDetails = [
    /自动化测试/,
    /未单独发布|未曾公开发布|完整并入/,
    /竞态崩溃/,
    /CPU 满载/,
    /重建麦克风采集/
  ];

  for (const surface of publicSurfaces) {
    for (const pattern of internalDetails) {
      assert.doesNotMatch(surface, pattern);
    }
  }

  const historicalWarning = allReleaseNotes[noteNames.indexOf("Chock-0.4.8.html")];
  for (const surface of [changelog, historicalWarning]) {
    assert.match(surface, /隐私提醒/);
    assert.match(surface, /旧截图/);
    assert.match(surface, /敏感信息/);
  }

  assert.match(releaseNotesPolicy, /数据丢失、错误修改或隐私泄露风险/);
  assert.match(releaseNotesPolicy, /主站与大陆站使用同一份静态文件/);
});

test("base compatibility stays distinct from offline translation requirements", () => {
  const jsonLdMatch = index.match(/<script type="application\/ld\+json">\s*([\s\S]*?)\s*<\/script>/);
  assert.ok(jsonLdMatch, "index.html must include JSON-LD metadata");
  const jsonLd = JSON.parse(jsonLdMatch[1]);

  assert.equal(jsonLd.operatingSystem, "macOS 14.0+");

  for (const id of ["top", "translatechapter", "allinone"]) {
    const surface = extractSection(id);
    assert.match(surface, /离线翻译/, `${id} must identify the offline translation feature`);
    assert.match(surface, /macOS 15\+/, `${id} must state the offline translation macOS requirement`);
    assert.doesNotMatch(surface, /不支持 Intel Mac/, `${id} must not repeat the Intel limitation`);
  }

  const download = extractSection("download");
  assert.match(download, /<b>macOS 14\.0\+<\/b> · Apple Silicon/);
  assert.match(download, /不支持 Intel Mac/);
  assert.match(download, /离线翻译需 macOS 15\+/);
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

  const releaseFiles = (await Promise.all(["0.4.0", "0.4.1", "0.4.2", "0.4.3", "0.4.4", "0.4.5", "0.4.6", "0.4.7", "0.4.8", "0.4.9", "0.5.0", "0.5.2", "0.5.3", "0.5.4", "0.5.5", "0.5.6", "0.5.7"].flatMap((version) => [
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

test("0.5.8 remains an empty unpublished draft", () => {
  assert.equal(next.version, "0.5.8");
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
    assert.doesNotMatch(surface, /0\.5\.8/);
  }
});

async function sha256(url) {
  return createHash("sha256").update(await readFile(url)).digest("hex");
}

function extractSection(id) {
  const match = index.match(new RegExp(`<section\\b[^>]*\\bid="${id}"[^>]*>[\\s\\S]*?<\\/section>`));
  assert.ok(match, `index.html must include the ${id} section`);
  return match[0];
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
