# 🪐 BiliUniverse: 🔀 Redirect
自动化重定向 CDN，让播放更流畅

## Loon 扩展

本 fork 额外提供一个仅面向 Loon 的可选 CDN 插件，用于重定向 Bilibili 普通视频 CDN。手动列表仅保留最近一次全量持续带宽测试中可请求成功的 CCB 节点。
需要 Loon `3.5.0(969)` 或更高版本，并在 Loon 的 MitM 设置中开启 **QUIC 回退保护**，让命中 MitM 域名的 HTTP/3/QUIC 视频流量回退到可被脚本处理的连接。

- [一键导入 Loon](https://www.nsloon.com/openloon/import?plugin=https%3A%2F%2Fraw.githubusercontent.com%2Fvulpsecula%2FBiliBili-CDN-Loon%2Fmain%2Fcustom%2FBiliBili.Redirect.CCBStyle.plugin)
- [查看 Raw 插件](https://raw.githubusercontent.com/vulpsecula/BiliBili-CDN-Loon/main/custom/BiliBili.Redirect.CCBStyle.plugin)
- [使用说明](docs/CCB_STYLE_LOON.md)

### 自动测速

开启 `⚡ 自动测速` 后，CDN request fallback 会使用当前真实视频的 signed URL，只在同 CDN family 的小候选池中比较吞吐：

1. 最多 4 个候选同时首测：Wi-Fi 每个 `512 KiB`，蜂窝网络每个 `384 KiB`；
2. 只有首测不足两个可用节点时，才对连接类异常低并发重试；
3. 预算足够时，对 Top 2 串行确认：Wi-Fi 每个 `1 MiB`，蜂窝网络每个 `768 KiB`；
4. 确认结果与首测加权排序，确认失败的节点降级；
5. 最终结果按 `网络 + CDN family` 独立缓存 6 小时，候选池变化会自动使对应旧缓存失效。

Akamai 等只有原始单候选的 family 会静默直通，不执行无意义测速。测速完成后只有在实际切换到不同 CDN 时才可能通知，并有通知冷却。

JSON `playurl` response hook 不再维护第二套测速引擎：手动模式仍可提前改写 DASH/durl；自动模式只应用已经存在的有效 family 缓存，未缓存的 family 交给 request fallback 统一测速。

### 手动持续带宽测试

插件菜单提供 `🎯 测试当前 CDN 持续带宽`。它不会重新选节点，而是针对当前正在使用/最近选择的单个 CDN 做更长的串行持续测试：

- 自动模式优先取最近实际请求的 CDN；没有最近请求时取最新 family 缓存；手动模式直接测试当前手动节点；
- `🎞 测试视频 BV号` 可在插件设置中自行填写，默认 `BV1eL4k6jEjd`；每次运行都会动态获取新的 signed URL；
- `⏱ 单轮测速秒数` 默认 `6` 秒，可配置为 `3–10` 秒，正式测试固定进行 3 轮；
- 先做不计分预热和校准，再根据校准带宽自适应每个 Range 请求块大小；
- 每一正式轮会连续串行请求多个 Range，直到达到目标时间或单轮流量上限，而不是只下载一个短样本；
- Wi-Fi 单轮流量上限 `64 MiB`，蜂窝网络单轮上限 `20 MiB`；结果显示每轮实际秒数、流量、Range 次数、中位数、最低/最高值和稳定度；
- 测试流量显式使用 `DIRECT`，且不会修改自动测速缓存、6 小时选择结果或当前 CDN。

这个手动测试参考 `scripts/bili_cdn_bandwidth.py` 的“预热不计分、串行多轮、中位数/最低值”思路。由于 Loon `$httpClient` 只能在完整响应结束后回调，移动端实现改为连续多个受控 Range 请求来逼近按时间窗口的持续带宽测量，同时避免一次把超大响应缓冲进内存。

如需在电脑上对完整 CCB 节点进行更长时间的持续带宽评估，可使用独立的[本地参考测速脚本](scripts/README.md)。该脚本仅用于离线比较，不是 Loon 插件的运行时依赖。

> [!IMPORTANT]
> 这是非官方 fork 的扩展，不隶属于 BiliUniverse、CCB、Bilibili Accelerator 或 Bilibili。不要与其他针对同一批视频请求的固定 CDN 重写同时启用。
