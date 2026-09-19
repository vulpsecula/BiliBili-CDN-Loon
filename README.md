<p align="center"><img src="assets/icon.png" width="128" alt="BiliBili CDN Redirect for Loon icon"></p>

# BiliBili CDN Redirect for Loon

[![Validate](https://github.com/vulpsecula/BiliBili-CDN-Loon/actions/workflows/validate.yml/badge.svg)](https://github.com/vulpsecula/BiliBili-CDN-Loon/actions/workflows/validate.yml)
[![License](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](LICENSE)

面向 **Loon** 的 Bilibili 视频 CDN 重定向插件。支持手动选择 CDN、按 CDN family 自动选择节点，以及用户主动触发的当前 CDN 持续带宽测试。

## 安装

需要 **Loon 3.5.1 (983)+**，并安装、信任 MitM 证书。为确保 Bilibili 的 QUIC/HTTP3 视频流量也能进入 MitM / Script，请开启：

```text
MitM → QUIC 回退保护
```

- [一键导入 Loon](https://www.nsloon.com/openloon/import?plugin=https%3A%2F%2Fraw.githubusercontent.com%2Fvulpsecula%2FBiliBili-CDN-Loon%2Fmain%2Fcustom%2FBiliBili.CDN.Redirect.Loon.plugin)
- [查看 Raw 插件](https://raw.githubusercontent.com/vulpsecula/BiliBili-CDN-Loon/main/custom/BiliBili.CDN.Redirect.Loon.plugin)
- [完整使用说明](docs/BILIBILI_CDN_REDIRECT_FOR_LOON.md)

## 快速开始

1. 导入插件并确认 MitM 证书正常工作，同时开启 **QUIC 回退保护**。
2. 在插件设置中选择一个 **目标 CDN 节点**。
3. 想固定使用该节点：保持 `⚡ 自动选择节点` 关闭；想让插件按当前网络自动选择：打开它。
4. 正常播放一个 Bilibili 视频。自动模式首次遇到未缓存的 CDN family 时会进行一次真实视频小样本测速，之后结果按网络与 family 缓存 6 小时。
5. 需要查看状态时运行 `📊 查看自动选择节点结果`；需要精测当前节点时，先播放视频几秒，再运行 `🎯 测试当前 CDN 持续带宽`。

> [!IMPORTANT]
> 从 **1.9.0** 起，插件文件、运行时命名和缓存 namespace 已统一为 **BiliBili CDN Redirect for Loon**。如果你从 1.8.x 或更早版本升级，建议先停用或删除旧插件条目，再通过上方链接重新导入。旧 Raw 插件地址不再维护，自动选择缓存也会重新建立。

## 功能

| 功能 | 行为 |
| --- | --- |
| 手动 CDN | 自动选择关闭时始终使用插件中选择的 CDN |
| 自动选择节点 | 使用当前真实视频 signed URL，只在同 signature family 的小候选池中比较吞吐；失败时回退手动 CDN |
| playurl 预改写 | JSON DASH/durl 响应可提前应用手动选择或已有的自动缓存 |
| 当前 CDN 持续带宽测试 | 复用最近真实播放 URL 与安全请求头，进行预热、校准和三轮串行 Range 测试 |
| 状态查看 | 显示当前网络、各 family 缓存、最近实际请求和失败诊断 |
| 直连测速 | 自动测速和手动长测均显式使用 `DIRECT` |

自动选择不会修改插件里的手动 CDN 下拉选项；`🎯 测试当前 CDN 持续带宽` 也不会修改自动选择缓存或当前 CDN。

## 支持平台

- iOS
- iPadOS
- macOS
- tvOS — **初步支持**。插件已经声明 tvOS 并使用 Loon 通用 Script API，但 Bilibili Apple TV 客户端的全部流量形态仍在实机验证中。

## 当前 CDN 持续带宽测试

推荐流程是：**先正常播放一个视频几秒，再运行测速**。插件会优先使用最近 30 分钟内真实播放产生的 signed URL 和非敏感请求头，因此正常情况下不会额外访问 Bilibili 网页/API。

默认每轮目标 6 秒，可设置为 3–10 秒，共测试 3 轮。Wi-Fi 每轮最多 64 MiB，蜂窝网络每轮最多 20 MiB，以避免无限制下载。

如果没有近期真实播放样本，脚本才会尝试从配置 BV 的普通网页内嵌 `window.__playinfo__` 获取 donor；这个 fallback 可能受到 Bilibili HTTP 412 风控影响。

## 注意事项

- 不要同时启用其他修改相同 Bilibili playurl 或 `/upgcxcode/` 请求的固定 CDN 插件。
- 自动测速和手动长测都走 `DIRECT`，因此结果反映直连 CDN 路径，不代表代理路径带宽。
- 手动节点列表是一次实测可用性快照，不代表未列出的节点永久不可用；当前列表来自 **2026-08-29** 的全量持续带宽筛选。
- CDN、签名和客户端请求形式可能变化；异常时优先查看 Loon Script 日志和 `📊 查看自动选择节点结果`。
- 更详细的 HTTP 412 / 403、未触发、tvOS 等排查方法见[完整使用说明](docs/BILIBILI_CDN_REDIRECT_FOR_LOON.md#故障排查)。

## 仓库结构

```text
.github/workflows/
  validate.yml

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

授权条款见 [LICENSE](LICENSE)。
