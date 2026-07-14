import assert from "node:assert/strict";
import { once } from "node:events";
import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import net from "node:net";

const manifest = JSON.parse(await readFile(new URL("../release-manifest.json", import.meta.url), "utf8"));
const port = await getOpenPort();
const origin = `http://127.0.0.1:${port}`;
const wrangler = new URL("../node_modules/.bin/wrangler", import.meta.url).pathname;
const child = spawn(wrangler, ["pages", "dev", ".", "--ip", "127.0.0.1", "--port", String(port)], {
  cwd: new URL("..", import.meta.url),
  stdio: ["ignore", "pipe", "pipe"]
});

let output = "";
child.stdout.on("data", (chunk) => { output += chunk; });
child.stderr.on("data", (chunk) => { output += chunk; });

try {
  await waitForServer();

  const home = await fetch(`${origin}/`);
  assert.equal(home.status, 200);
  assert.match(home.headers.get("content-type") ?? "", /^text\/html\b/);
  assert.match(await home.text(), new RegExp(`下载 Chock ${escapeRegExp(manifest.current.version)}`));

  const changelog = await fetch(`${origin}/changelog`);
  assert.equal(changelog.status, 200);
  assert.match(
    await changelog.text(),
    new RegExp(`${escapeRegExp(manifest.current.version)} · ${escapeRegExp(manifest.current.releaseDate)}`)
  );

  const releaseNotes = await fetch(`${origin}${manifest.current.releaseNotesPath}`);
  assert.equal(releaseNotes.status, 200);
  const releaseNotesHTML = await releaseNotes.text();
  assert.match(releaseNotesHTML, /首次截图会正常请求权限/);
  assert.match(releaseNotesHTML, /面板不再被长提示撑大/);
  assert.match(releaseNotesHTML, /截图提示音可关/);
  assert.match(releaseNotesHTML, /应用与链接可以放进同一组/);

  await assertRedirect("/dl", manifest.current.dmg.path);
  await assertRedirect("/dl/", manifest.current.dmg.path);
  await assertRedirect("/dl/Chock.dmg", manifest.current.dmg.path);
  await assertRedirect("/dl/Chock.zip", manifest.current.zip.path);

  await assertAsset(manifest.current.dmg.path, "application/x-apple-diskimage", manifest.current.dmg.size);
  await assertAsset(manifest.current.zip.path, "application/zip", manifest.current.zip.size);

  for (const path of [
    "/dl/Chock-0.4.0.dmg",
    "/dl/Chock-0.4.1.dmg",
    "/dl/Chock-0.4.2.dmg",
    "/dl/Chock-0.4.3.dmg",
    "/dl/Chock-0.4.4.dmg",
    "/dl/Chock-0.4.0.zip",
    "/dl/Chock-0.4.1.zip",
    "/dl/Chock-0.4.2.zip",
    "/dl/Chock-0.4.3.zip",
    "/dl/Chock-0.4.4.zip"
  ]) {
    await assertAsset(path, path.endsWith(".dmg") ? "application/x-apple-diskimage" : "application/zip");
  }

  for (const path of [
    "/dl/does-not-exist.dmg",
    "/dl/Chock-0.4.6.dmg",
    "/dl/Chock-0.3.9.zip",
    "/definitely-missing"
  ]) {
    const response = await fetch(`${origin}${path}`, { redirect: "manual" });
    assert.equal(response.status, 404, `${path} must fail closed`);
    assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/, `${path} must be an HTML error`);
    assert.equal(response.headers.has("content-disposition"), false, `${path} must not look downloadable`);
    assert.match(await response.text(), /404 · NOT FOUND/);
  }

  console.log(`Pages download contract passed at ${origin}`);
} catch (error) {
  console.error(output.trim());
  throw error;
} finally {
  child.kill("SIGTERM");
  await Promise.race([once(child, "exit"), new Promise((resolve) => setTimeout(resolve, 3000))]);
  if (child.exitCode === null) child.kill("SIGKILL");
}

async function assertRedirect(path, destination) {
  const response = await fetch(`${origin}${path}`, { redirect: "manual" });
  assert.equal(response.status, 302, `${path} must be a temporary release alias`);
  assert.equal(new URL(response.headers.get("location"), origin).pathname, destination);

  const followed = await fetch(`${origin}${path}`);
  assert.equal(followed.status, 200);
  assert.ok(
    ["application/x-apple-diskimage", "application/zip"].includes(followed.headers.get("content-type")),
    `${path} must end at a binary asset`
  );
}

async function assertAsset(path, contentType, expectedSize) {
  const response = await fetch(`${origin}${path}`);
  assert.equal(response.status, 200, `${path} must exist`);
  assert.equal(response.headers.get("content-type"), contentType);
  assert.match(response.headers.get("content-disposition") ?? "", /^attachment;/);
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  const body = await response.arrayBuffer();
  if (expectedSize !== undefined) assert.equal(body.byteLength, expectedSize);
  assert.ok(body.byteLength > 1_000_000, `${path} must not be an HTML fallback`);
}

async function waitForServer() {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`wrangler exited before startup (${child.exitCode})`);
    try {
      const response = await fetch(`${origin}/`);
      if (response.ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error("timed out waiting for wrangler pages dev");
}

async function getOpenPort() {
  const server = net.createServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const { port } = server.address();
  server.close();
  await once(server, "close");
  return port;
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
