import assert from "node:assert/strict";
import { readFile, readdir, stat } from "node:fs/promises";
import test from "node:test";
import {
  normalizeBaseURL,
  renderAppcast,
  renderCanonicalPage,
  renderIndex,
  renderRobots,
  renderSitemap,
  shouldCopyRootEntry
} from "../scripts/build-site.mjs";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");
const [
  index,
  changelog,
  privacy,
  appcast,
  robots,
  sitemap,
  manifest
] = await Promise.all([
  read("index.html"),
  read("changelog.html"),
  read("privacy/index.html"),
  read("appcast.xml"),
  read("robots.txt"),
  read("sitemap.xml"),
  read("release-manifest.json").then(JSON.parse)
]);
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

test("CN build excludes Cloudflare-only controls without touching public assets", () => {
  for (const file of ["CNAME", "_headers", "_redirects"]) {
    assert.equal(shouldCopyRootEntry(file, "https://getchock.com"), true);
    assert.equal(shouldCopyRootEntry(file, "https://getchock.cn"), false);
  }
  for (const file of ["index.html", "robots.txt", "sitemap.xml", "og-card.png"]) {
    assert.equal(shouldCopyRootEntry(file, "https://getchock.com"), true);
    assert.equal(shouldCopyRootEntry(file, "https://getchock.cn"), true);
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
