# Chock 0.4.4 发行记录

状态：`published`。0.4.3 制品保持不可变；本版使用新版本路径发布最终的菜单截图与箭头修复，下一版 `0.4.5` 保持 draft。

## 发行身份

- App 版本：`0.4.4 (260)`
- 源码提交：`b1aefc2da9aae552a6ecaf12f66f0b9f7a6d41cf`
- Apple 公证 submission：`47e590a1-fbd5-41e1-9bd0-ba811e745f9d`（`Accepted`）
- Bundle ID：`com.actionlens.app`
- Team ID：`ZLHF65NR6Q`

## 不可变制品

| 文件 | bytes | SHA-256 |
|---|---:|---|
| `Chock-0.4.4.dmg` | 4,199,761 | `2b96ec0557531edb7290dc638dd519e4e569eb9f96d6e0564e63ffb2ab1a934f` |
| `Chock-0.4.4.zip` | 3,834,702 | `f9c4d370dc8fc3bbfc595aa98d9f9f6cce9468ac18f7e45844779bda0eb73dd1` |

Sparkle EdDSA signature：

`mLzwijs9CtbP7Ue5l2FPSmE5EsNIZLBKbkNjyGSP41farwau4yLORqqvWDZyJAWNWQfWebRBbF8y6U7uFDXgCQ==`

## 同步面

- 首页 JSON-LD、下载按钮、文件大小和移动端复制链接
- `appcast.xml` 首项及 Sparkle signature
- 官网更新历史和应用内 release notes
- `/dl`、`/dl/`、`/dl/Chock.dmg`、`/dl/Chock.zip` 版本别名
- DMG/ZIP 精确响应头与 404 fail-closed 契约
- `release-manifest.json`，并建立 0.4.5 draft

## CN 源站同步门

`cn.getchock.com` 由独立 nginx 源站响应，Cloudflare Pages 的 `_redirects` / `_headers` 不会自动改变它。发布时必须：

1. 同步新的首页、changelog、release notes、appcast 和 404 页面到实际 document root。
2. 上传当前 DMG/ZIP 到实际 `dl/` 目录，并核对 byte size 与 SHA-256。
3. 将 `/dl`、`/dl/`、`/dl/Chock.dmg`、`/dl/Chock.zip` 临时重定向到 0.4.4；`/dl/` 其余请求继续使用 `try_files $uri =404`。
4. DMG 返回 `application/x-apple-diskimage`，ZIP 返回 `application/zip`，并带 `X-Content-Type-Options: nosniff`。
5. reload nginx；若前面仍有 CDN，则 purge 首页、appcast、aliases 与 0.4.4 文件路径。
6. 使用同一组 HTTP 契约同时检查 global 与 CN，确认版本、状态码、类型、字节和 SHA-256 一致。

## HTTP 契约

- `/dl`、`/dl/`、`/dl/Chock.dmg` -> `302` 到当前 DMG。
- `/dl/Chock.zip` -> `302` 到当前 ZIP。
- 当前版本 DMG/ZIP -> `200`、准确的 binary `Content-Type`、`Content-Disposition: attachment`。
- 不存在版本或拼错文件 -> `404`、`text/html`，且不得出现 attachment header。
