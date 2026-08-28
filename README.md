# 🪐 BiliUniverse: 🔀 Redirect
自动化重定向 CDN，让播放更流畅

## Loon 扩展

本 fork 额外提供一个仅面向 Loon 的可选 CDN 插件，用于重定向 Bilibili 普通视频 CDN，并保留完整 CCB 节点的手动选择。
需要 Loon `3.5.0(969)` 或更高版本。

- [一键导入 Loon](https://www.nsloon.com/openloon/import?plugin=https%3A%2F%2Fraw.githubusercontent.com%2Fvulpsecula%2FBiliBili-CDN-Loon%2Fmain%2Fcustom%2FBiliBili.Redirect.CCBStyle.plugin)
- [查看 Raw 插件](https://raw.githubusercontent.com/vulpsecula/BiliBili-CDN-Loon/main/custom/BiliBili.Redirect.CCBStyle.plugin)
- [使用说明](docs/CCB_STYLE_LOON.md)

### 自动测速

开启 `⚡ 自动测速` 后，CDN request fallback 会使用当前真实视频的 signed URL，只在同 CDN family 的小候选池中比较吞吐：

1. 所有候选统一读取约 `768 KiB`；
2. DNS / timeout / 连接异常节点最多低并发重试一次；
3. 预算足够时，对 Top 2 逐个串行读取 `512 KiB` 再确认；
4. 最终结果按 `网络 + CDN family` 独立缓存 6 小时。

Akamai 等只有原始单候选的 family 会静默直通，不执行无意义测速。测速完成后只有在实际切换到不同 CDN 时才可能通知，并有通知冷却。

JSON `playurl` response hook 不再维护第二套测速引擎：手动模式仍可提前改写 DASH/durl；自动模式只应用已经存在的有效 family 缓存，未缓存的 family 交给 request fallback 统一测速。

> [!IMPORTANT]
> 这是非官方 fork 的扩展，不隶属于 BiliUniverse、CCB、Bilibili Accelerator 或 Bilibili。不要与其他针对同一批视频请求的固定 CDN 重写同时启用。
