# 双域静态站发布

`getchock.com` 与 `getchock.cn` 共用同一份源码，但不能继续共用字节完全相同的发布目录：`canonical`、`og:url`、JSON-LD URL、sitemap 和 robots 都必须声明当前域名。

使用显式参数生成两个互不覆盖的候选目录：

```sh
npm run build:site -- \
  --base-url https://getchock.com \
  --out-dir .site-build/getchock.com

npm run build:site -- \
  --base-url https://getchock.cn \
  --out-dir .site-build/getchock.cn
```

输出目录必须尚不存在；脚本不会删除或覆盖旧候选。项目内输出只允许放在 `.site-build/`，也可以使用项目外的绝对路径。

构建会：

- 从 `release-manifest.json` 读取当前版本、下载路径和 release note；下载 CTA 的版本、href 与静态 Mac 文案由构建流程一次生成。
- 为首页生成当前域名的 canonical、`og:url`、OG/Twitter 图片 URL、JSON-LD `url` 与 `downloadUrl`。
- 为更新历史、隐私政策和当前 release note 生成当前域名 canonical。
- 复用 `render-regional-appcast.mjs`，为当前域名生成 appcast，并生成对应 robots 与 sitemap。
- 原样保留仓库内全部百度验证文件；首页已有的每个百度验证 meta 都必须能映射到对应验证文件。
- 只在 `getchock.cn` 首页页脚展示已核验的工信部备案号与公安备案链接。
- 从 CN 目录排除 Cloudflare 专用的 `CNAME`、`_headers`、`_redirects`；上海 nginx 的下载别名、MIME 与缓存规则仍须按其独立配置验收。

发布前必须分别对两个候选目录运行 HTTP/页面检查。不要把 `.com` 候选原样复制到 `.cn`，也不要在浏览器运行时用 JavaScript 改 canonical。

构建完成后必须核对输出日志中的版本与当前生产发布基线一致；如果 manifest、首页或 appcast 版本不一致，测试和构建都会失败，不能用旧目录覆盖生产内容。
