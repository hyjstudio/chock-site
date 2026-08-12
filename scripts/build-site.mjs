import { cp, lstat, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { renderRegionalAppcast } from "./render-regional-appcast.mjs";

const PROJECT_ROOT = fileURLToPath(new URL("..", import.meta.url));
const SUPPORTED_BASE_URLS = new Set([
  "https://getchock.com",
  "https://getchock.cn"
]);
const DEVELOPMENT_ENTRIES = new Set([
  ".git",
  ".gitignore",
  ".playwright-cli",
  ".site-build",
  ".wrangler",
  "docs",
  "node_modules",
  "package-lock.json",
  "package.json",
  "scripts",
  "tests"
]);
const CLOUDFLARE_ONLY_ENTRIES = new Set(["CNAME", "_headers", "_redirects"]);
const EXTERNAL_ONLY_ENTRIES = new Set(["legacy-alias-contract.json"]);
const CHINA_BASE_URL = "https://getchock.cn";
const CHINA_ICP_RECORD = "闽ICP备2026027906号-1";
const CHINA_PUBLIC_SECURITY_RECORD = "闽公网安备35018102240191号";
const CHINA_PUBLIC_SECURITY_URL =
  "https://beian.mps.gov.cn/#/query/webSearch?code=35018102240191";

export async function buildSite({
  baseURL,
  outDir,
  sourceDir = PROJECT_ROOT
}) {
  const normalizedBaseURL = normalizeBaseURL(baseURL);
  if (!outDir) throw new Error("--out-dir is required");

  const sourceRoot = path.resolve(sourceDir);
  const outputRoot = path.resolve(outDir);
  validateOutputPath(sourceRoot, outputRoot);
  await assertMissing(outputRoot);

  const manifest = JSON.parse(await readFile(path.join(sourceRoot, "release-manifest.json"), "utf8"));
  const legacyAliasContract = JSON.parse(
    await readFile(path.join(sourceRoot, "legacy-alias-contract.json"), "utf8")
  );
  validateLegacyAliasContract(legacyAliasContract, manifest.current);

  await mkdir(outputRoot, { recursive: true });

  const entries = await readdir(sourceRoot, { withFileTypes: true });
  for (const entry of entries) {
    if (!shouldCopyRootEntry(entry.name, normalizedBaseURL)) continue;
    await cp(
      path.join(sourceRoot, entry.name),
      path.join(outputRoot, entry.name),
      { recursive: entry.isDirectory(), preserveTimestamps: true }
    );
  }

  const currentNotePath = manifest.current.releaseNotesPath;
  const currentNoteFile = currentNotePath.replace(/^\//, "");

  await transformTextFile(outputRoot, "index.html", (html) =>
    renderIndex(html, { baseURL: normalizedBaseURL, manifest })
  );
  await transformTextFile(outputRoot, "changelog.html", (html) =>
    renderCanonicalPage(html, normalizedBaseURL, "/changelog")
  );
  await transformTextFile(outputRoot, "privacy/index.html", (html) =>
    renderCanonicalPage(html, normalizedBaseURL, "/privacy/")
  );
  await transformTextFile(outputRoot, currentNoteFile, (html) =>
    renderCanonicalPage(html, normalizedBaseURL, currentNotePath)
  );
  await transformTextFile(outputRoot, "appcast.xml", (xml) =>
    renderAppcast(xml, normalizedBaseURL)
  );
  await transformTextFile(outputRoot, "robots.txt", (robots) =>
    renderRobots(robots, normalizedBaseURL)
  );
  await transformTextFile(outputRoot, "sitemap.xml", (sitemap) =>
    renderSitemap(sitemap, normalizedBaseURL)
  );

  return {
    baseURL: normalizedBaseURL,
    outDir: outputRoot,
    currentVersion: manifest.current.version
  };
}

export function renderIndex(html, { baseURL, manifest }) {
  const normalizedBaseURL = normalizeBaseURL(baseURL);
  let rendered = html;

  rendered = replaceExactlyOnce(
    rendered,
    /<link rel="canonical" href="[^"]+">/,
    `<link rel="canonical" href="${normalizedBaseURL}/">`,
    "homepage canonical"
  );
  rendered = replaceExactlyOnce(
    rendered,
    /<meta property="og:url" content="[^"]+">/,
    `<meta property="og:url" content="${normalizedBaseURL}/">`,
    "homepage og:url"
  );
  rendered = replaceExactlyOnce(
    rendered,
    /<meta property="og:image" content="[^"]+">/,
    `<meta property="og:image" content="${normalizedBaseURL}/og-card.png">`,
    "homepage og:image"
  );
  rendered = replaceExactlyOnce(
    rendered,
    /<meta name="twitter:image" content="[^"]+">/,
    `<meta name="twitter:image" content="${normalizedBaseURL}/og-card.png">`,
    "homepage twitter:image"
  );
  rendered = renderDownloadAction(rendered, manifest.current);

  const jsonLdPattern =
    /<script type="application\/ld\+json">\s*([\s\S]*?)\s*<\/script>/;
  const jsonLdMatch = rendered.match(jsonLdPattern);
  if (!jsonLdMatch) throw new Error("homepage JSON-LD block is missing");
  const jsonLd = JSON.parse(jsonLdMatch[1]);
  if (jsonLd.softwareVersion !== manifest.current.version) {
    throw new Error("homepage JSON-LD version does not match release manifest");
  }
  jsonLd.url = `${normalizedBaseURL}/`;
  jsonLd.downloadUrl = new URL(
    manifest.current.dmg.path,
    `${normalizedBaseURL}/`
  ).href;
  const renderedJsonLd = JSON.stringify(jsonLd, null, 2);
  rendered = rendered.replace(jsonLdMatch[1], renderedJsonLd);

  const complianceHook = "<span data-cn-compliance></span>";
  if (!rendered.includes(complianceHook)) {
    throw new Error("homepage CN compliance build hook is missing");
  }
  const complianceMarkup = normalizedBaseURL === CHINA_BASE_URL
    ? `<span data-cn-compliance> · ${CHINA_ICP_RECORD} · <a href="${CHINA_PUBLIC_SECURITY_URL}" target="_blank" rel="noopener noreferrer" style="color:var(--text-2)">${CHINA_PUBLIC_SECURITY_RECORD}</a></span>`
    : complianceHook;
  rendered = rendered.replace(complianceHook, complianceMarkup);

  return rendered;
}

function renderDownloadAction(html, release) {
  const version = release?.version;
  const dmgPath = release?.dmg?.path;
  if (typeof version !== "string" || !version || typeof dmgPath !== "string" || !dmgPath) {
    throw new Error("release manifest is missing the current download CTA metadata");
  }

  return replaceExactlyOnce(
    html,
    /<a class="btn" id="dlBtn" href="[^"]+" data-release-version="[^"]+">[^<]*<\/a>/,
    `<a class="btn" id="dlBtn" href="${dmgPath}" data-release-version="${version}">下载 Chock ${version} · macOS 版</a>`,
    "homepage download CTA"
  );
}

export function renderCanonicalPage(html, baseURL, route) {
  const normalizedBaseURL = normalizeBaseURL(baseURL);
  const canonicalURL = new URL(route, `${normalizedBaseURL}/`).href;
  const canonicalPattern = /<link rel="canonical" href="[^"]+">/;

  if (canonicalPattern.test(html)) {
    return replaceExactlyOnce(
      html,
      canonicalPattern,
      `<link rel="canonical" href="${canonicalURL}">`,
      `${route} canonical`
    );
  }
  if (!html.includes("</head>")) throw new Error(`${route} is missing </head>`);
  return html.replace("</head>", `<link rel="canonical" href="${canonicalURL}">\n</head>`);
}

export function renderAppcast(xml, baseURL) {
  return renderRegionalAppcast(xml, normalizeBaseURL(baseURL));
}

export function renderRobots(robots, baseURL) {
  const normalizedBaseURL = normalizeBaseURL(baseURL);
  return replaceExactlyOnce(
    robots,
    /^Sitemap:\s+https:\/\/getchock\.com\/sitemap\.xml$/m,
    `Sitemap: ${normalizedBaseURL}/sitemap.xml`,
    "robots sitemap"
  );
}

export function renderSitemap(sitemap, baseURL) {
  const normalizedBaseURL = normalizeBaseURL(baseURL);
  if (!sitemap.includes("<loc>https://getchock.com/")) {
    throw new Error("canonical sitemap must contain getchock.com URLs");
  }
  return sitemap.replaceAll(
    "<loc>https://getchock.com/",
    `<loc>${normalizedBaseURL}/`
  );
}

export function normalizeBaseURL(baseURL) {
  const normalized = String(baseURL ?? "").replace(/\/+$/, "");
  if (!SUPPORTED_BASE_URLS.has(normalized)) {
    throw new Error(
      `--base-url must be one of: ${[...SUPPORTED_BASE_URLS].join(", ")}`
    );
  }
  return normalized;
}

export function shouldCopyRootEntry(name, baseURL) {
  if (DEVELOPMENT_ENTRIES.has(name) || name.startsWith(".")) return false;
  if (baseURL === CHINA_BASE_URL && CLOUDFLARE_ONLY_ENTRIES.has(name)) {
    return false;
  }
  if (baseURL !== CHINA_BASE_URL && EXTERNAL_ONLY_ENTRIES.has(name)) {
    return false;
  }
  return true;
}

export function validateLegacyAliasContract(contract, currentRelease) {
  const expectedTopLevelKeys = [
    "aliases",
    "contractKind",
    "hostingMode",
    "releaseVersion",
    "schemaVersion"
  ];
  const expectedAliasKeys = ["source", "status", "target"];
  const releaseVersion = currentRelease?.version;
  const dmgPath = currentRelease?.dmg?.path;
  const zipPath = currentRelease?.zip?.path;

  if (!isPlainObject(contract)) {
    throw new Error("legacy alias contract must be a JSON object");
  }
  assertExactKeys(contract, expectedTopLevelKeys, "legacy alias contract");
  if (contract.schemaVersion !== 1) {
    throw new Error("legacy alias contract schemaVersion must be 1");
  }
  if (contract.contractKind !== "chock-legacy-download-aliases") {
    throw new Error("legacy alias contract contractKind is invalid");
  }
  if (contract.hostingMode !== "external") {
    throw new Error("legacy alias contract hostingMode must be external");
  }
  if (typeof releaseVersion !== "string" || !releaseVersion) {
    throw new Error("release manifest is missing the current version");
  }
  if (dmgPath !== `/dl/Chock-${releaseVersion}.dmg`
      || zipPath !== `/dl/Chock-${releaseVersion}.zip`) {
    throw new Error("release manifest current asset paths do not match its version and extensions");
  }
  if (contract.releaseVersion !== releaseVersion) {
    throw new Error("legacy alias contract releaseVersion does not match the release manifest");
  }
  if (!Array.isArray(contract.aliases) || contract.aliases.length !== 4) {
    throw new Error("legacy alias contract must contain exactly four aliases");
  }

  const expectedAliases = new Map([
    ["/dl", dmgPath],
    ["/dl/", dmgPath],
    ["/dl/Chock.dmg", dmgPath],
    ["/dl/Chock.zip", zipPath]
  ]);
  const seenSources = new Set();
  for (const alias of contract.aliases) {
    if (!isPlainObject(alias)) {
      throw new Error("legacy alias entries must be JSON objects");
    }
    assertExactKeys(alias, expectedAliasKeys, "legacy alias entry");
    if (!expectedAliases.has(alias.source)) {
      throw new Error(`legacy alias contract contains an unknown source: ${alias.source}`);
    }
    if (seenSources.has(alias.source)) {
      throw new Error(`legacy alias contract contains a duplicate source: ${alias.source}`);
    }
    seenSources.add(alias.source);
    if (alias.target !== expectedAliases.get(alias.source)) {
      throw new Error(`legacy alias target does not match the current release: ${alias.source}`);
    }
    if (alias.status !== 302) {
      throw new Error(`legacy alias status must be 302: ${alias.source}`);
    }
  }
  if (seenSources.size !== expectedAliases.size) {
    throw new Error("legacy alias contract is missing a required source");
  }
}

function isPlainObject(value) {
  return value !== null
    && typeof value === "object"
    && !Array.isArray(value)
    && Object.getPrototypeOf(value) === Object.prototype;
}

function assertExactKeys(value, expectedKeys, label) {
  const actualKeys = Object.keys(value).sort();
  if (actualKeys.length !== expectedKeys.length
      || actualKeys.some((key, index) => key !== expectedKeys[index])) {
    throw new Error(`${label} has unexpected schema keys`);
  }
}

async function transformTextFile(outputRoot, relativePath, transform) {
  const file = path.join(outputRoot, relativePath);
  const source = await readFile(file, "utf8");
  await writeFile(file, transform(source), "utf8");
}

function validateOutputPath(sourceRoot, outputRoot) {
  if (outputRoot === sourceRoot) {
    throw new Error("output directory must not be the source directory");
  }
  const relative = path.relative(sourceRoot, outputRoot);
  if (
    relative &&
    !relative.startsWith("..") &&
    relative.split(path.sep)[0] !== ".site-build"
  ) {
    throw new Error("output inside the project must be under .site-build/");
  }
}

async function assertMissing(target) {
  try {
    await lstat(target);
  } catch (error) {
    if (error?.code === "ENOENT") return;
    throw error;
  }
  throw new Error(`output directory already exists: ${target}`);
}

function replaceExactlyOnce(source, pattern, replacement, label) {
  const matches = source.match(new RegExp(pattern.source, pattern.flags.includes("g")
    ? pattern.flags
    : `${pattern.flags}g`));
  if ((matches?.length ?? 0) !== 1) {
    throw new Error(`${label} must match exactly once`);
  }
  return source.replace(pattern, replacement);
}

function parseArguments(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--base-url") {
      options.baseURL = argv[++index];
    } else if (argument.startsWith("--base-url=")) {
      options.baseURL = argument.slice("--base-url=".length);
    } else if (argument === "--out-dir") {
      options.outDir = argv[++index];
    } else if (argument.startsWith("--out-dir=")) {
      options.outDir = argument.slice("--out-dir=".length);
    } else {
      throw new Error(`unknown argument: ${argument}`);
    }
  }
  return options;
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  const result = await buildSite(options);
  console.log(
    `Built Chock ${result.currentVersion} for ${result.baseURL} at ${result.outDir}`
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
