import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  buildSite,
  normalizeBaseURL,
  renderAppcast,
  renderCanonicalPage,
  renderIndex,
  renderRobots,
  renderSitemap,
  shouldCopyRootEntry,
  validateLegacyAliasContract
} from "../scripts/build-site.mjs";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");
const [
  index,
  changelog,
  privacy,
  appcast,
  robots,
  sitemap,
  manifest,
  legacyAliasContractText
] = await Promise.all([
  read("index.html"),
  read("changelog.html"),
  read("privacy/index.html"),
  read("appcast.xml"),
  read("robots.txt"),
  read("sitemap.xml"),
  read("release-manifest.json").then(JSON.parse),
  read("legacy-alias-contract.json")
]);
const legacyAliasContract = JSON.parse(legacyAliasContractText);
const projectRoot = fileURLToPath(new URL("..", import.meta.url));
const legacyAliasContractBytes = await readFile(
  new URL("../legacy-alias-contract.json", import.meta.url)
);
const redirectsBytes = await readFile(new URL("../_redirects", import.meta.url));
const currentNote = await read(manifest.current.releaseNotesPath.replace(/^\//, ""));

const variants = [
  { baseURL: "https://getchock.com", host: "getchock.com" },
  { baseURL: "https://getchock.cn", host: "getchock.cn" }
];

test("homepage SEO metadata is rendered deterministically per domain", () => {
  for (const { baseURL, host } of variants) {
    const rendered = renderIndex(index, { baseURL, manifest });
    const jsonLd = extractJsonLd(rendered);

    assert.match(rendered, new RegExp(`<link rel="canonical" href="https://${escapeRegExp(host)}/">`));
    assert.match(rendered, new RegExp(`<meta property="og:url" content="https://${escapeRegExp(host)}/">`));
    assert.match(rendered, new RegExp(`<meta property="og:image" content="https://${escapeRegExp(host)}/og-card\\.png">`));
    assert.match(rendered, new RegExp(`<meta name="twitter:image" content="https://${escapeRegExp(host)}/og-card\\.png">`));
    assert.equal(jsonLd.url, `${baseURL}/`);
    assert.equal(jsonLd.downloadUrl, `${baseURL}${manifest.current.dmg.path}`);
    assert.equal(jsonLd.softwareVersion, manifest.current.version);
    assert.match(rendered, /codeva-U5Dyeuwe3g/);
    assert.match(rendered, /codeva-VwgjKKJnWf/);
    assert.doesNotMatch(rendered, /document\.(querySelector|createElement)\([^)]*canonical/i);
  }
});

test("homepage download CTA is synchronized from the release manifest", () => {
  const staleVersion = "9.9.9";
  const stalePath = `/dl/Chock-${staleVersion}.dmg`;
  const staleIndex = index.replace(
    /<a class="btn" id="dlBtn" href="[^"]+" data-release-version="[^"]+">[^<]*<\/a>/,
    `<a class="btn" id="dlBtn" href="${stalePath}" data-release-version="${staleVersion}">下载 Chock ${staleVersion} · macOS 版</a>`
  );

  assert.notEqual(staleIndex, index, "test fixture must make the source CTA stale");
  for (const { baseURL } of variants) {
    const rendered = renderIndex(staleIndex, { baseURL, manifest });
    const button = rendered.match(/<a class="btn" id="dlBtn"[^>]*>[^<]*<\/a>/)?.[0];

    assert.ok(button, "rendered homepage must include the download CTA");
    assert.match(button, new RegExp(`href="${escapeRegExp(manifest.current.dmg.path)}"`));
    assert.match(button, new RegExp(`data-release-version="${escapeRegExp(manifest.current.version)}"`));
    assert.match(button, new RegExp(`>下载 Chock ${escapeRegExp(manifest.current.version)} · macOS 版<\\/a>`));
    assert.doesNotMatch(button, new RegExp(escapeRegExp(staleVersion)));
  }
});

test("CN filing data is visible only in the CN build", () => {
  const globalIndex = renderIndex(index, {
    baseURL: "https://getchock.com",
    manifest
  });
  const chinaIndex = renderIndex(index, {
    baseURL: "https://getchock.cn",
    manifest
  });

  assert.doesNotMatch(globalIndex, /闽ICP备2026027906号-1|闽公网安备35018102240191号/);
  assert.match(globalIndex, /<span data-cn-compliance><\/span>/);
  assert.match(chinaIndex, /闽ICP备2026027906号-1/);
  assert.match(chinaIndex, /闽公网安备35018102240191号/);
  assert.match(
    chinaIndex,
    /href="https:\/\/beian\.mps\.gov\.cn\/#\/query\/webSearch\?code=35018102240191"/
  );
  assert.doesNotMatch(chinaIndex, /手机号|联系电话|电子邮箱|身份证/);
});

test("public indexable pages receive host-correct canonicals", () => {
  for (const { baseURL } of variants) {
    const pages = [
      [changelog, "/changelog"],
      [privacy, "/privacy/"],
      [currentNote, manifest.current.releaseNotesPath]
    ];
    for (const [html, route] of pages) {
      const rendered = renderCanonicalPage(html, baseURL, route);
      const expected = new URL(route, `${baseURL}/`).href;
      assert.equal(
        (rendered.match(/<link rel="canonical" href="[^"]+">/g) ?? []).length,
        1
      );
      assert.match(rendered, new RegExp(`<link rel="canonical" href="${escapeRegExp(expected)}">`));
    }
  }
});

test("robots, sitemap, and appcast are rendered for both domains", () => {
  for (const { baseURL, host } of variants) {
    const renderedRobots = renderRobots(robots, baseURL);
    const renderedSitemap = renderSitemap(sitemap, baseURL);
    const renderedAppcast = renderAppcast(appcast, baseURL);

    assert.match(renderedRobots, new RegExp(`^Sitemap: https://${escapeRegExp(host)}/sitemap\\.xml$`, "m"));
    for (const loc of extractLocations(renderedSitemap)) {
      assert.equal(new URL(loc).host, host);
    }
    assert.match(renderedAppcast, new RegExp(`https://${escapeRegExp(host)}${escapeRegExp(manifest.current.zip.path)}`));
    assert.match(renderedAppcast, new RegExp(`https://${escapeRegExp(host)}${escapeRegExp(manifest.current.releaseNotesPath)}`));
  }
});

test("sitemap lists only real public pages with current lastmod values", async () => {
  const expected = new Map([
    ["https://getchock.com/", ["index.html", "2026-07-29"]],
    ["https://getchock.com/changelog", ["changelog.html", manifest.current.releaseDate]],
    ["https://getchock.com/privacy/", ["privacy/index.html", "2026-07-16"]],
    [
      `https://getchock.com${manifest.current.releaseNotesPath}`,
      [manifest.current.releaseNotesPath.replace(/^\//, ""), manifest.current.releaseDate]
    ]
  ]);
  const entries = extractSitemapEntries(sitemap);

  assert.equal(entries.length, expected.size);
  for (const entry of entries) {
    const expectation = expected.get(entry.loc);
    assert.ok(expectation, `unexpected sitemap URL: ${entry.loc}`);
    const [file, lastmod] = expectation;
    assert.equal(entry.lastmod, lastmod);
    assert.ok((await stat(new URL(`../${file}`, import.meta.url))).isFile());
  }
});

test("Baidu verification assets and metadata remain part of both builds", async () => {
  const verificationFiles = (await readdir(new URL("..", import.meta.url)))
    .filter((file) => /^baidu_verify_codeva-[A-Za-z0-9]+\.html$/.test(file))
    .sort();

  assert.ok(verificationFiles.length >= 3);
  for (const file of verificationFiles) {
    assert.ok((await stat(new URL(`../${file}`, import.meta.url))).isFile());
    assert.equal(shouldCopyRootEntry(file, "https://getchock.com"), true);
    assert.equal(shouldCopyRootEntry(file, "https://getchock.cn"), true);
  }

  const metaCodes = [...index.matchAll(
    /<meta name="baidu-site-verification" content="([^"]+)" \/>/g
  )].map((match) => match[1]);
  assert.ok(metaCodes.length > 0);
  for (const code of metaCodes) {
    assert.ok(verificationFiles.includes(`baidu_verify_${code}.html`));
  }
});

test("host-bound copy policy separates Cloudflare controls from the external alias contract", () => {
  for (const file of ["CNAME", "_headers", "_redirects"]) {
    assert.equal(shouldCopyRootEntry(file, "https://getchock.com"), true);
    assert.equal(shouldCopyRootEntry(file, "https://getchock.cn"), false);
  }
  assert.equal(shouldCopyRootEntry("legacy-alias-contract.json", "https://getchock.com"), false);
  assert.equal(shouldCopyRootEntry("legacy-alias-contract.json", "https://getchock.cn"), true);
  for (const file of ["index.html", "robots.txt", "sitemap.xml", "og-card.png"]) {
    assert.equal(shouldCopyRootEntry(file, "https://getchock.com"), true);
    assert.equal(shouldCopyRootEntry(file, "https://getchock.cn"), true);
  }
});

test("external legacy alias contract is exact and bound to the current manifest", () => {
  assert.doesNotThrow(() => validateLegacyAliasContract(legacyAliasContract, manifest.current));
  assert.deepEqual(legacyAliasContract, {
    schemaVersion: 1,
    contractKind: "chock-legacy-download-aliases",
    hostingMode: "external",
    releaseVersion: manifest.current.version,
    aliases: [
      { source: "/dl", target: manifest.current.dmg.path, status: 302 },
      { source: "/dl/", target: manifest.current.dmg.path, status: 302 },
      { source: "/dl/Chock.dmg", target: manifest.current.dmg.path, status: 302 },
      { source: "/dl/Chock.zip", target: manifest.current.zip.path, status: 302 }
    ]
  });
});

test("external legacy alias contract rejects malformed, stale, and caller-shaped inputs", () => {
  const fixture = () => structuredClone(legacyAliasContract);
  const missingTopLevelKey = fixture();
  delete missingTopLevelKey.contractKind;
  const missingAliasKey = fixture();
  delete missingAliasKey.aliases[0].target;
  const cases = [
    ["string input", "caller supplied contract text"],
    ["extra top-level key", Object.assign(fixture(), { contractPath: "/tmp/caller.json" })],
    ["missing top-level key", missingTopLevelKey],
    ["wrong schema", Object.assign(fixture(), { schemaVersion: 2 })],
    ["string schema", Object.assign(fixture(), { schemaVersion: "1" })],
    ["wrong kind", Object.assign(fixture(), { contractKind: "caller-aliases" })],
    ["wrong hosting mode", Object.assign(fixture(), { hostingMode: "cloudflare" })],
    ["stale release", Object.assign(fixture(), { releaseVersion: "0.5.7" })],
    ["aliases is not an array", Object.assign(fixture(), { aliases: {} })],
    ["stale target", Object.assign(fixture(), {
      aliases: fixture().aliases.map((alias, index) => index === 0
        ? { ...alias, target: "/dl/Chock-0.5.7.dmg" }
        : alias)
    })],
    ["missing alias", Object.assign(fixture(), { aliases: fixture().aliases.slice(0, 3) })],
    ["extra alias", Object.assign(fixture(), {
      aliases: [...fixture().aliases, { source: "/caller", target: manifest.current.dmg.path, status: 302 }]
    })],
    ["duplicate alias", Object.assign(fixture(), {
      aliases: [fixture().aliases[0], fixture().aliases[0], ...fixture().aliases.slice(2)]
    })],
    ["unknown source", Object.assign(fixture(), {
      aliases: fixture().aliases.map((alias, index) => index === 0
        ? { ...alias, source: "/caller" }
        : alias)
    })],
    ["wrong DMG target", Object.assign(fixture(), {
      aliases: fixture().aliases.map((alias, index) => index === 0
        ? { ...alias, target: manifest.current.zip.path }
        : alias)
    })],
    ["wrong ZIP target", Object.assign(fixture(), {
      aliases: fixture().aliases.map((alias) => alias.source === "/dl/Chock.zip"
        ? { ...alias, target: manifest.current.dmg.path }
        : alias)
    })],
    ["wrong status", Object.assign(fixture(), {
      aliases: fixture().aliases.map((alias, index) => index === 0
        ? { ...alias, status: 307 }
        : alias)
    })],
    ["string status", Object.assign(fixture(), {
      aliases: fixture().aliases.map((alias, index) => index === 0
        ? { ...alias, status: "302" }
        : alias)
    })],
    ["extra alias key", Object.assign(fixture(), {
      aliases: fixture().aliases.map((alias, index) => index === 0
        ? { ...alias, note: "caller text" }
        : alias)
    })],
    ["missing alias key", missingAliasKey]
  ];

  for (const [label, contract] of cases) {
    assert.throws(
      () => validateLegacyAliasContract(contract, manifest.current),
      undefined,
      label
    );
  }

  const staleManifest = structuredClone(manifest.current);
  staleManifest.version = "0.5.9";
  staleManifest.dmg.path = "/dl/Chock-0.5.9.dmg";
  staleManifest.zip.path = "/dl/Chock-0.5.9.zip";
  assert.throws(
    () => validateLegacyAliasContract(legacyAliasContract, staleManifest),
    /releaseVersion does not match/
  );

  const wrongExtensionManifest = structuredClone(manifest.current);
  wrongExtensionManifest.dmg.path = `/dl/Chock-${manifest.current.version}.zip`;
  assert.throws(
    () => validateLegacyAliasContract(legacyAliasContract, wrongExtensionManifest),
    /asset paths do not match/
  );
});

test("build fails before creating output when the fixed external contract is stale", async () => {
  const temporaryRoot = await mkdtemp(path.join(tmpdir(), "chock-site-invalid-alias-contract."));
  const sourceDir = path.join(temporaryRoot, "source");
  const outDir = path.join(temporaryRoot, "output");
  const staleContract = structuredClone(legacyAliasContract);
  staleContract.releaseVersion = "0.5.7";
  await mkdir(sourceDir);
  await writeFile(
    path.join(sourceDir, "release-manifest.json"),
    JSON.stringify({ current: manifest.current }),
    "utf8"
  );
  await writeFile(
    path.join(sourceDir, "legacy-alias-contract.json"),
    JSON.stringify(staleContract),
    "utf8"
  );

  try {
    await assert.rejects(
      buildSite({ baseURL: "https://getchock.cn", outDir, sourceDir }),
      /releaseVersion does not match/
    );
    await assert.rejects(stat(outDir), /ENOENT/);
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});

test("CN build copies the fixed source contract byte-for-byte while Cloudflare keeps redirects", async () => {
  const temporaryRoot = await mkdtemp(path.join(tmpdir(), "chock-site-alias-contract."));
  const globalOutput = path.join(temporaryRoot, "getchock.com");
  const mainlandOutput = path.join(temporaryRoot, "getchock.cn");
  try {
    await buildSite({
      baseURL: "https://getchock.com",
      outDir: globalOutput,
      sourceDir: projectRoot
    });
    await buildSite({
      baseURL: "https://getchock.cn",
      outDir: mainlandOutput,
      sourceDir: projectRoot,
      legacyAliasContract: "caller supplied text",
      contractPath: "/tmp/caller.json"
    });

    await assert.rejects(readFile(path.join(globalOutput, "legacy-alias-contract.json")), /ENOENT/);
    assert.deepEqual(await readFile(path.join(globalOutput, "_redirects")), redirectsBytes);
    await assert.rejects(readFile(path.join(mainlandOutput, "_redirects")), /ENOENT/);
    assert.deepEqual(
      await readFile(path.join(mainlandOutput, "legacy-alias-contract.json")),
      legacyAliasContractBytes
    );
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});

test("unsupported hosts and ambiguous output URLs fail closed", () => {
  assert.equal(normalizeBaseURL("https://getchock.cn/"), "https://getchock.cn");
  assert.throws(() => normalizeBaseURL("https://www.getchock.cn"), /must be one of/);
  assert.throws(() => normalizeBaseURL("http://getchock.cn"), /must be one of/);
});

function extractJsonLd(html) {
  const match = html.match(/<script type="application\/ld\+json">\s*([\s\S]*?)\s*<\/script>/);
  assert.ok(match, "JSON-LD block is missing");
  return JSON.parse(match[1]);
}

function extractLocations(xml) {
  return [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((match) => match[1]);
}

function extractSitemapEntries(xml) {
  return [...xml.matchAll(/<url>\s*<loc>([^<]+)<\/loc>\s*<lastmod>([^<]+)<\/lastmod>[\s\S]*?<\/url>/g)]
    .map((match) => ({ loc: match[1], lastmod: match[2] }));
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
