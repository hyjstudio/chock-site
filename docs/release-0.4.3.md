# Chock 0.4.3 发行记录

状态：`published`。站点发布面统一指向真实签名、公证制品，下一版 `0.4.4` 保持 draft。

## 发行身份

- App 版本：`0.4.3 (257)`
- 源码提交：`fc6d1ea9ab21ddb1a27d0275d8a2a7f14522f8de`
- Apple 公证 submission：`0aef0604-47cf-4f85-ae29-ce92606f8da2`（`Accepted`）
- Bundle ID：`com.actionlens.app`
- Team ID：`ZLHF65NR6Q`

## 不可变制品

| 文件 | bytes | SHA-256 |
|---|---:|---|
| `Chock-0.4.3.dmg` | 4,179,279 | `74a6f55ad73abb100d536ee6d1bdddc107e7c9031a7b224d255fdf19ef22cd01` |
| `Chock-0.4.3.zip` | 3,815,425 | `451e3e49ebf3700a99c47c3e89d7a9b931ca05f8e5b633120b3d4f2b72cae2f4` |

Sparkle EdDSA signature：

`DWxQ+1RKqV5D9mucXCzxpnKZVHXhGjRiGyJLT+CJX4+PrajoKfFGNpqa+7qHsT9m2X33dN4zek47s1bkLKI1Dg==`

## 同步面

- 首页 JSON-LD、下载按钮、文件大小和移动端复制链接
- `appcast.xml` 首项及 Sparkle signature
- 官网更新历史和应用内 release notes
- `/dl`、`/dl/`、`/dl/Chock.dmg`、`/dl/Chock.zip` 版本别名
- DMG/ZIP 精确响应头与 404 fail-closed 契约
- `release-manifest.json`，并建立 0.4.4 draft

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
