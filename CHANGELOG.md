# Changelog

## 1.9.2

- 修复当前 CDN 持续带宽测试在慢节点上可能因 1 MiB / 6 秒预热门槛过高而直接超时的问题。
- 新增轻量预检：Wi-Fi 256 KiB、蜂窝 128 KiB，最长 10 秒；校准和正式 Range 请求也放宽超时。
- playurl 与真实 CDN request 现在按网络和 family 保存最近 donor，单节点测速优先使用同 family signed URL。
- 任意预检失败都会对照测试 donor 原始 host，以区分目标 CDN 不可用、跨 family 不兼容与 signed URL 失效。
- 跨 family donor 预检失败时，会尝试配置 BV 网页中的同 family donor；网页受 HTTP 412 风控时保留明确诊断。

## 1.9.1

- 为 Loon 插件加入独立图片图标，并移除插件名称前的 `📺` 文本 emoji。
- 新增 `assets/icon.png`，插件通过 `#!icon` 使用该图标。
- README 顶部改为图片品牌图标，不再依赖文本 emoji 作为 logo。

## 1.9.0

- 项目与插件统一命名为 **BiliBili CDN Redirect for Loon**。
- 运行时文件统一为 `BiliBili.CDN.Redirect.Loon.*`，插件 Raw 地址随之更新。
- 持久化缓存命名空间与内部测速请求头统一到新命名；升级后自动选择缓存会重新建立。
- 清理不再参与当前 Loon 插件运行的旧多平台 Node/Rspack/BoxJS/模板构建树。
- 将旧构建/发布 Actions 替换为轻量的 Loon 插件静态验证 workflow。
- 文档最低版本统一为 Loon `3.5.1(983)`，并清理历史测速引擎版本文案。

## 1.8.3

- 同步上游深圳 Akamai `upos-sz-mirrorakam.akamaized.net` 支持。
- Akamai request fallback 与 MitM 现覆盖 hz / sz / bstar1 三种 UPOS host。

## 1.8.2

- 使用 Loon Script V2 复合条件排除内部测速请求，并仅处理 HTTP 200 的 playurl 响应。
- 为两个 Generic Script 增加图标并补充插件 metadata。

## 1.8.1

- 将插件 `[Script]` 配置迁移到 Loon Script V2。
- 最低 Loon 版本提高到 `3.5.1(983)`。

## 1.8.0

- 声明 tvOS 支持，开始 Apple TV 兼容验证。

## 1.7.2

- 单节点持续带宽测试优先复用最近真实播放 signed URL 与安全请求头。
- 增加 HTTP 403 原始 host 对照诊断。
