# Chock 0.4.3 站点发行骨架

状态：`draft`。`release-manifest.json` 中 0.4.3 的日期、build number、文件路径、size、SHA-256 和 Sparkle signature 保持 `null`，直到真实产物生成并完成签名、公证和校验。

## 生成产物后

1. 保留已有 `dl/` 文件，把真实 `Chock-0.4.3.dmg` 与 `Chock-0.4.3.zip` 加入本地 `dl/`。
2. 从真实文件读取 byte size 与 SHA-256；从 Sparkle 签名工具读取 ZIP 的 `sparkle:edSignature`，不要手填猜测值。
3. 填完 manifest 的 0.4.3 draft 字段后，再同步更新：
   - `index.html` 的 JSON-LD、下载按钮、下载元信息和 `DMG_URL`；
   - `appcast.xml` 的首个 item；
   - `changelog.html` 与 `notes/Chock-0.4.3.html`；
   - `_redirects` 的 legacy aliases；
   - `_headers` 中 0.4.3 DMG/ZIP 的精确规则。
4. 把 0.4.3 的 manifest 状态改为 `published`，并把下一版 draft 另起一项；在此之前，首页和 appcast 不得引用 0.4.3。
5. 运行 `npm run verify`。部署属于单独步骤，本骨架不会自动 push 或发布。

## CN 源站同步门

`cn.getchock.com` 当前由独立 nginx 源站响应，仓库内的 Cloudflare Pages `_redirects` / `_headers` 不会自动改变它。发布前需要在 CN 源站执行并复核：

1. 同步新的首页、changelog、release notes、appcast 和 404 页面到实际 document root。
2. 上传当前 DMG/ZIP 到实际 `dl/` 目录，逐个核对 byte size 或 SHA-256。
3. nginx 为 `/dl`、`/dl/`、`/dl/Chock.dmg`、`/dl/Chock.zip` 配置到当前版本的临时重定向；`/dl/` 下其余请求使用 `try_files $uri =404`，不能 fallback 到 `index.html`。
4. DMG 返回 `application/x-apple-diskimage`，ZIP 返回 `application/zip`，并带 `X-Content-Type-Options: nosniff`。
5. reload nginx；若 CN 前面还有 CDN，再 purge 首页、appcast、aliases 和当前版本文件路径。
6. 用文末同一组 HTTP 契约检查 global 与 CN，确认两边 current version、状态码、类型和 byte size 一致。

## HTTP 契约

- `/dl`、`/dl/`、`/dl/Chock.dmg` -> `302` 到当前 DMG。
- `/dl/Chock.zip` -> `302` 到当前 ZIP。
- 当前版本 DMG/ZIP -> `200`、准确的 binary `Content-Type`、`Content-Disposition: attachment`。
- 不存在版本或拼错文件 -> `404`、`text/html`，且不得出现 attachment header。
