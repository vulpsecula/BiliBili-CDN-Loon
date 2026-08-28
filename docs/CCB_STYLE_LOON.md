# CCB Style for Loon

这是 `BiliUniverse/Redirect` 的非官方 Loon 扩展：它不等待 Bilibili 选择 CDN，而是把命中 `/upgcxcode/` 的普通视频请求强制改写到你在插件参数中选定的节点；也可以开启自动测速，让插件根据当前真实视频分片的实际吞吐率自动选择候选节点。

## 安装

在 iPhone、iPad 或已安装 Loon 的 Mac 上点击：

[**一键导入 Loon**](https://www.nsloon.com/openloon/import?plugin=https%3A%2F%2Fraw.githubusercontent.com%2Fvulpsecula%2FBiliBili-CDN-Loon%2Fmain%2Fcustom%2FBiliBili.Redirect.CCBStyle.plugin)

如果浏览器未唤起 Loon，请复制以下 Raw 地址，然后在 Loon 的「配置 → 插件」中手动添加：

```text
https://raw.githubusercontent.com/vulpsecula/BiliBili-CDN-Loon/main/custom/BiliBili.Redirect.CCBStyle.plugin
```

如果你正在测试 PR 分支，请把 URL 中的 `main` 替换为对应分支名。合并回 `main` 后再改回上述地址。

## 使用

Loon 需要升级到 `3.5.0(969)` 或更高版本。插件通过请求脚本接收 `{cdn}` / `{auto}` 参数并替换目标主机名。

1. 启用插件，并在插件参数中选择一个手动 CDN 作为默认/回退节点。
2. 如需自动选择，开启「⚡ 自动测速」。开启后自动测速结果优先于手动 CDN；测速失败或已有其他测速任务运行时会临时回退到手动节点。
3. 安装并信任 Loon MITM 证书，确认 MITM 已启用。
4. 确保 Bilibili 流量能按你的 Loon 策略正常连接。
5. 播放普通视频。自动模式在没有有效缓存时会用该视频的真实 `/upgcxcode/` 签名 URL 进行测速；有缓存时会直接使用缓存中的最快节点。

默认手动节点是 `cn-hk-eq-01-01.bilivideo.com`。节点效果取决于所在地、运营商和当时网络，并不存在对所有人都最快的固定选项。

## 自动测速

自动测速参考 Bilibili Accelerator 的思路，优先衡量真实视频数据传输能力，而不是仅按 TCP/TLS/TTFB 延迟排序。

测速不会一次测试完整的数百个节点，而是采用两阶段抽样，避免一次测速产生过大的额外流量和过长的首播等待：

- 第一阶段：从每个可测速地区挑一个代表节点，使用约 `128 KiB` 的 Range 请求做快速筛选，并发上限 8。
- 第二阶段：选择第一阶段表现最好的 3 个地区，每个地区最多挑 4 个不同类型/运营商节点，使用约 `512 KiB` 的 Range 请求进行更可靠的吞吐比较，并发上限 6。
- Akamai、明显的 gotcha/302 PCDN 类节点不参与自动候选，但仍保留在手动节点列表中。
- 如果所有 Range 请求都按预期返回，完整无缓存测速的有效下载量通常不超过约 9 MiB；失败请求和服务端异常行为可能使实际流量略有差异。

测速值是 Loon `$httpClient` 从请求开始到响应完成的“有效吞吐率”，因此会包含连接建立时间，不等同于浏览器 `ReadableStream` 能测出的纯稳态传输速率。不过第二阶段使用较大的 512 KiB 样本，能够显著降低单纯延迟对排序的影响。

测速结果按当前 Wi-Fi SSID（以及 Loon 运行模式）缓存 6 小时。相同网络下后续播放不会重复测速；不同 Wi-Fi 会使用独立缓存。蜂窝网络无法取得 SSID 时会共用 `cellular-or-unknown` 缓存键。

首次完成测速后，Loon 会通知：

- 最快节点、地区和 Mbps；
- Top 5 测试结果；
- 完整的本轮已测试节点排名可从通知的剪贴板内容和脚本日志中取得。

插件同时提供 `📊 查看 CDN 测速结果` 的 Generic Script 入口，可随时查看当前网络的缓存结果。通知显示 Top 10，并将完整已测试节点排名放入剪贴板。

> Loon 的 `[Argument] select` 是静态插件配置，脚本 API 不能在测速后动态修改下拉项目文本，因此无法把 `83.4 Mbps` 之类的实时值直接写在每一个节点名称旁边。测速结果通过通知、Generic Script、日志和剪贴板展示。

## 自动分流与直连

- 「自动分流」决定请求由哪个 Loon 策略出口连接，例如直连、某个代理节点或策略组。
- 「直连」只是其中一种出口决策，表示不经过代理服务器。
- 本插件负责改写视频 CDN 主机名，不代替你的分流规则。改写后的请求以及测速请求仍会按 Loon 的网络环境和规则进行连接。

## 注意事项

- 不要同时启用其他会改写同一批 `/upgcxcode/` 请求的固定 CDN 插件，否则结果取决于重写顺序。
- 规则仅对相关视频域名拒绝 QUIC，使请求回退到可被 HTTP 重写和 MITM 处理的连接。
- 请求路径、查询参数、签名与 `Range` 请求头保持不变；请求脚本只替换 scheme、hostname 并清除原端口。
- 自动测速使用当前真实视频 URL，只替换 hostname 并发起独立的小范围 Range 请求；不会把视频 URL 或测速结果上传到本项目服务器。
- CCB 节点列表、Bilibili 的签名策略或 CDN 行为可能随时变化；某些节点可能拒绝同一签名 URL，此类节点会被本轮测速判为不可用。

## 与上游的关系

本分支与插件为非官方修改，不隶属于 BiliUniverse、CCB 或 Bilibili Accelerator。

- Based on [BiliUniverse/Redirect](https://github.com/BiliUniverse/Redirect)
- Inspired by [Kanda-Akihito-Kun/ccb](https://github.com/Kanda-Akihito-Kun/ccb)
- Auto speed-test approach inspired by [realzza/bilibili-accelerator](https://github.com/realzza/bilibili-accelerator)

当前 Loon 实现是请求脚本改写，未直接复制 CCB 或 Bilibili Accelerator 的浏览器 Hook 代码。原项目授权条款见各自仓库。
