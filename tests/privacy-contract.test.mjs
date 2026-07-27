import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("privacy policy describes the product's actual data paths", async () => {
  const [privacy, index] = await Promise.all([
    read("privacy/index.html"),
    read("index.html")
  ]);

  assert.match(privacy, /<link rel="canonical" href="https:\/\/getchock\.com\/privacy\/">/);

  const macApp = extractSection(privacy, "mac-app");
  assert.match(macApp, /在本机处理/);
  assert.match(macApp, /自动检查更新/);
  assert.match(macApp, /可以在设置中关闭/);
  assert.match(macApp, /购买或激活/);
  assert.match(macApp, /订单编号/);
  assert.match(macApp, /支付渠道交易号/);
  assert.match(macApp, /不会要求或存储姓名、手机号、电子邮箱或 Chock 账号/);
  assert.match(macApp, /服务端的异步确认结果/);
  assert.match(macApp, /本机验签/);
  assert.match(macApp, /不依赖持续联网/);
  assert.match(macApp, /IP 地址/);

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

  assert.match(index, /功能内容不上传/);
  assert.match(index, /购买与激活/);
  assert.match(index, /服务端异步确认/);
  assert.match(index, /本机验签/);
  assert.doesNotMatch(index, /用户数据不上传|数据零上传|你的数据只在本机|唯一的网络请求|不再发出任何请求|应用不上传用户数据/);
});

function extractSection(html, id) {
  const match = html.match(new RegExp(`<section\\b[^>]*\\bid="${id}"[^>]*>[\\s\\S]*?<\\/section>`));
  assert.ok(match, `privacy policy must include the ${id} section`);
  return match[0];
}
