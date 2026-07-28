import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const GLOBAL_BASE_URL = "https://getchock.com";
const ALLOWED_BASE_URLS = new Set([GLOBAL_BASE_URL, "https://getchock.cn"]);

export function renderRegionalAppcast(source, baseURL) {
  const normalizedBaseURL = baseURL.replace(/\/+$/, "");
  if (!ALLOWED_BASE_URLS.has(normalizedBaseURL)) {
    throw new Error(`unsupported appcast base URL: ${baseURL}`);
  }

  const globalPrefix = `${GLOBAL_BASE_URL}/`;
  const regionalPrefix = `${normalizedBaseURL}/`;
  const globalReferences = source.match(/https:\/\/getchock\.com\//g) ?? [];

  if (globalReferences.length < 2) {
    throw new Error("canonical appcast must contain global download and release-notes URLs");
  }
  if (source.includes("https://getchock.cn/")) {
    throw new Error("canonical appcast must not mix global and mainland authorities");
  }

  return source.replaceAll(globalPrefix, regionalPrefix);
}

async function main() {
  const args = process.argv.slice(2);
  const option = (name, fallback) => {
    const index = args.indexOf(name);
    return index === -1 ? fallback : args[index + 1];
  };

  const input = option("--input", "appcast.xml");
  const output = option("--output");
  const baseURL = option("--base-url");

  if (!output || !baseURL) {
    throw new Error("usage: render-regional-appcast.mjs --base-url <https-url> --output <path> [--input appcast.xml]");
  }

  const source = await readFile(input, "utf8");
  await writeFile(output, renderRegionalAppcast(source, baseURL), "utf8");
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await main();
}
