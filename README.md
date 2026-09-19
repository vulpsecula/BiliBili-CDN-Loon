# 📺 BiliBili CDN Redirect for Loon

面向 Loon 的 Bilibili 视频 CDN 重定向插件。支持手动选择 CDN、按 CDN family 自动测速选择节点，以及用户主动触发的当前 CDN 持续带宽测试。

## 安装

需要 Loon `3.5.1(983)` 或更高版本，并安装、信任 MitM 证书。建议开启 **MitM → QUIC 回退保护**，让命中 MitM 域名的 QUIC/HTTP3 视频流量回退到可被脚本处理的连接。

- [一键导入 Loon](https://www.nsloon.com/openloon/import?plugin=https%3A%2F%2Fraw.githubusercontent.com%2Fvulpsecula%2FBiliBili-CDN-Loon%2Fmain%2Fcustom%2FBiliBili.CDN.Redirect.Loon.plugin)
- [查看 Raw 插件](https://raw.githubusercontent.com/vulpsecula/BiliBili-CDN-Loon/main/custom/BiliBili.CDN.Redirect.Loon.plugin)
- [使用说明](docs/BILIBILI_CDN_REDIRECT_FOR_LOON.md)

> 从 `1.9.0` 起插件文件与运行时命名已统一。旧 Raw 插件地址不再维护；从旧版本升级时请使用上方链接重新导入。自动选择缓存会重新建立。

## 功能

- **手动 CDN**：关闭自动选择时，始终使用插件中选定的 CDN。
- **自动选择节点**：真实视频请求触发同 family 小候选池测速，结果按网络与 family 缓存 6 小时；失败时回退手动 CDN。
- **playurl 预改写**：JSON DASH/durl 响应可提前应用手动选择或已有自动缓存。
- **持续带宽测试**：`🎯 测试当前 CDN 持续带宽` 复用最近真实播放的 signed URL 与安全请求头，进行预热、校准和三轮串行 Range 测试，不修改自动选择缓存。
- **状态查看**：`📊 查看自动选择节点结果` 显示当前网络、各 family 缓存、最近实际请求和失败诊断。
- **平台**：iOS、iPadOS、macOS、tvOS。

## 仓库结构

```text
custom/
  BiliBili.CDN.Redirect.Loon.plugin
  BiliBili.CDN.Redirect.Loon.request.js
  BiliBili.CDN.Redirect.Loon.response.js
  BiliBili.CDN.Redirect.Loon.bandwidth.js
  BiliBili.CDN.Redirect.Loon.result.js

docs/
  BILIBILI_CDN_REDIRECT_FOR_LOON.md

scripts/
  bili_cdn_bandwidth.py
  README.md
```

`custom/` 是 Loon 运行时；`scripts/` 中的 Python 工具仅用于桌面环境下的完整 CDN 持续带宽参考测试，不是插件运行依赖。

## 上游与来源

本项目是非官方 fork，不隶属于 Biliverse、CCB、Bilibili 或 Bilibili Accelerator。

- Based on [Biliverse/Redirect](https://github.com/Biliverse/Redirect)
- CDN list based on [Kanda-Akihito-Kun/ccb](https://github.com/Kanda-Akihito-Kun/ccb)
- Auto speed-test approach inspired by [realzza/bilibili-accelerator](https://github.com/realzza/bilibili-accelerator)

授权条款见 [LICENSE](LICENSE)。不要与其他修改同一批 Bilibili playurl 或 `/upgcxcode/` 请求的固定 CDN 插件同时启用。
