# CCB Style for Loon

这是 `BiliUniverse/Redirect` 的非官方 Loon 扩展。插件保留完整 CCB CDN 节点的手动选择，同时提供基于真实视频数据吞吐率的自动测速。

从 `1.4.0` 开始，插件采用两层重定向：优先拦截 Bilibili JSON `playurl` 响应，在播放器真正下载前修改 DASH / durl 中的 CDN；如果客户端走未覆盖的播放 API（例如部分 App gRPC）或直接得到 MCDN 地址，则由 CDN 请求脚本作为 fallback 继续处理。

## 安装

在 iPhone、iPad 或已安装 Loon 的 Mac 上点击：

[**一键导入 Loon**](https://www.nsloon.com/openloon/import?plugin=https%3A%2F%2Fraw.githubusercontent.com%2Fvulpsecula%2FBiliBili-CDN-Loon%2Fmain%2Fcustom%2FBiliBili.Redirect.CCBStyle.plugin)

如果浏览器未唤起 Loon，请复制以下 Raw 地址，然后在 Loon 的「配置 → 插件」中手动添加：

```text
https://raw.githubusercontent.com/vulpsecula/BiliBili-CDN-Loon/main/custom/BiliBili.Redirect.CCBStyle.plugin
```

Loon 需要 `3.5.0(969)` 或更高版本，并需要安装、信任 MITM 证书。

## 手动模式

`目标 CDN 节点` 始终保留，默认是：

```text
cn-hk-eq-01-01.bilivideo.com
```

关闭 `⚡ 自动测速` 时，手动节点拥有最高优先级：

1. 如果命中 JSON playurl，插件直接把 DASH `baseUrl/base_url/backupUrl/backup_url` 和传统 `durl` 改到手动节点。
2. 如果没有命中 playurl，后续 `/upgcxcode/` CDN 请求仍会由 request fallback 改到同一个手动节点。

因此自动测速功能不会取代或修改你的手动选择。你随时可以关闭自动测速，立即恢复到原先选定的节点。

## 自动模式优先级

开启 `⚡ 自动测速` 后：

```text
当前网络 6 小时有效测速缓存
        ↓ 没有
真实视频 URL 两阶段测速
        ↓ 失败 / 并发已有测速任务
手动选择的目标 CDN
```

自动测速不会把结果写回 `[Argument]` 的 CDN 下拉框。测速结果保存在 Loon `$persistentStore`；手动选择始终作为独立配置和 fallback 保留。

## playurl 响应优先

插件优先监听常见 JSON 播放接口，包括普通视频、番剧和 PUGV 的 `playurl` 路径。命中后会从响应中找到实际视频 URL，再进行测速或手动重定向。

这样做有几个好处：

- 可以在播放器发起视频下载前完成 CDN 选择；
- 原始地址即使是 `mcdn.bilivideo.cn:4483`，也可以从 playurl 中拿到真实带签名 URL；
- DASH 的主链接和备用链接可以一起重写；
- 自动测速可以直接复用当前视频的签名、路径和查询参数。

部分 Bilibili App 可能使用 protobuf / gRPC 播放接口，当前插件不会修改其二进制 playurl 响应；这种情况下会进入下面的 CDN 请求 fallback。

## CDN 请求 fallback

插件继续监听：

- `*.bilivideo.com/upgcxcode/`
- `*.acgvideo.com/upgcxcode/`
- `*.bilivideo.cn/upgcxcode/`（包括常见 MCDN）
- 支持的 Akamai UPOS 地址

因此即使 playurl hook 没有触发，只要客户端最终请求上述视频 URL，手动重定向和自动测速仍然可以工作。

## 自动测速

测速参考 Bilibili Accelerator 的思路，优先衡量真实视频数据传输能力，而不是仅按 TCP/TLS/TTFB 延迟排序。

测速不会一次测试完整数百个节点，而采用两阶段抽样：

- 第一阶段：每个可测速地区选择一个代表节点，以约 `128 KiB` 的 Range 请求快速筛选，并发上限 8。
- 第二阶段：取第一阶段表现最好的 3 个地区，每个地区最多 4 个不同类型/运营商节点，以约 `512 KiB` 的 Range 请求进行更可靠的吞吐比较，并发上限 6。
- Akamai、明显的 gotcha/302 PCDN 类节点目前不参与自动候选，但仍保留在手动节点列表。
- 正常情况下，一次完整无缓存测速的数据量远低于对完整 CCB 节点逐个测速。

测速请求使用当前视频的真实 signed URL，仅替换 hostname，并保持路径和查询参数。测速结果是 Loon `$httpClient` 从请求开始到响应完成计算的有效 Mbps，因此包含连接建立开销；第二阶段使用更大的样本以减少单纯延迟对排序的影响。

## 缓存

测速结果按当前 Wi-Fi SSID和 Loon 运行模式缓存 6 小时：

- 同一网络后续播放直接复用最快节点；
- 不同 Wi-Fi 使用独立缓存；
- 蜂窝网络无法取得 SSID 时使用 `cellular-or-unknown`；
- 网络缓存过期后，下次播放重新测速。

## 查看测速状态 / 结果

插件提供：

```text
📊 查看 CDN 测速状态 / 结果
```

这个 Generic Script 不主动测速，而是读取插件当前状态。它现在会显示：

- 自动测速是否开启；
- 当前手动 CDN；
- 当前网络缓存；
- 最后一次触发来自 `playurl 响应` 还是 `CDN 请求 fallback`；
- `等待 / 测速中 / 成功 / 使用缓存 / 失败` 状态；
- 测速失败时的具体原因；
- 成功时最快节点、Mbps、地区和 Top 10 结果；
- 完整已测试排名可通过通知剪贴板取得。

脚本同时把这些信息写到 Loon 脚本日志，因此不会再只有 `------ Script done -------` 而没有诊断信息。

> Loon 的 `[Argument] select` 是静态插件配置，脚本 API 不能在测速后动态修改下拉项目文本，所以不能把实时 Mbps 直接写在每个节点名称旁边。

## 自动分流与直连

- 本插件只决定 Bilibili 视频请求使用哪个 CDN hostname。
- 最终走直连还是代理，仍由你的 Loon 规则和策略决定。
- 测速请求同样遵循当前 Loon 网络环境。

## 注意事项

- 不要同时启用其他会修改同一批 Bilibili playurl 或 `/upgcxcode/` 请求的 CDN 插件，否则结果取决于脚本执行顺序。
- 插件对相关视频域名拒绝 QUIC，让流量回退到可被 HTTP/MITM 脚本处理的连接。
- 请求级 fallback 只替换 scheme、hostname 和端口，保留原路径、签名参数和 Range。
- playurl 响应改写只处理 DASH / durl 媒体 URL，不修改无关图片或 API URL。
- 自动测速不会把视频 URL 或测速结果上传到本项目服务器。
- CCB 节点、Bilibili 播放接口和签名策略都可能变化；如果测速失败，可通过“查看 CDN 测速状态 / 结果”直接看到最后触发来源和错误原因。

## 与上游的关系

本分支与插件为非官方修改，不隶属于 BiliUniverse、CCB 或 Bilibili Accelerator。

- Based on [BiliUniverse/Redirect](https://github.com/BiliUniverse/Redirect)
- Inspired by [Kanda-Akihito-Kun/ccb](https://github.com/Kanda-Akihito-Kun/ccb)
- Auto speed-test approach inspired by [realzza/bilibili-accelerator](https://github.com/realzza/bilibili-accelerator)

原项目授权条款见各自仓库。
