import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("privacy policy describes the product's actual data paths", async () => {
  const privacy = await read("privacy/index.html");

  assert.match(privacy, /<link rel="canonical" href="https:\/\/getchock\.com\/privacy\/">/);

  const macApp = extractSection(privacy, "mac-app");
  assert.match(macApp, /在本机处理/);
  assert.match(macApp, /自动检查更新/);
  assert.match(macApp, /可以在设置中关闭/);

  const safari = extractSection(privacy, "safari-extension");
  assert.match(safari, /本地收藏副本/);
  assert.match(safari, /用户主动选择/);
  assert.match(safari, /不读取或修改 Safari 原始收藏/);
  assert.match(safari, /不在 Chrome 与 Safari 之间同步/);

  const favicon = extractSection(privacy, "favicon-requests");
  assert.match(favicon, /先直接向收藏网站请求 favicon/);
  assert.match(favicon, /Google favicon 服务/);
  assert.match(favicon, /origin/);
  assert.match(favicon, /不包含收藏标题、路径或查询参数/);

  assert.match(privacy, /不需要账号/);
  assert.match(privacy, /不含广告/);
  assert.match(privacy, /不使用分析或追踪工具/);
  assert.doesNotMatch(privacy, /全程零联网|零网络请求|所有数据绝不离开设备|整个产品绝不联网/);
});

function extractSection(html, id) {
  const match = html.match(new RegExp(`<section\\b[^>]*\\bid="${id}"[^>]*>[\\s\\S]*?<\\/section>`));
  assert.ok(match, `privacy policy must include the ${id} section`);
  return match[0];
}
