# CCB Style for Loon

这是 `BiliUniverse/Redirect` 的非官方 Loon 扩展。插件的手动列表保留最近一次全量持续带宽测试中可请求成功的 CCB CDN 节点，同时提供基于真实视频分片吞吐率的自动测速。

当前实现把职责拆成两层：

- **playurl response hook**：负责解析 JSON DASH/durl。手动模式可以提前把媒体 URL 改到手动 CDN；自动模式只应用已经存在的有效 family 缓存，不再运行独立测速引擎。
- **CDN request fallback**：负责自动测速、最终 CDN 选择和实际请求改写，是自动模式唯一的测速引擎。

这样避免 playurl 与 request 两套测速缓存、锁和排名算法互相覆盖，同时保留手动 playurl 改写能力。

## 安装

在 iPhone、iPad 或已安装 Loon 的 Mac 上点击：

[**一键导入 Loon**](https://www.nsloon.com/openloon/import?plugin=https%3A%2F%2Fraw.githubusercontent.com%2Fvulpsecula%2FBiliBili-CDN-Loon%2Fmain%2Fcustom%2FBiliBili.Redirect.CCBStyle.plugin)

如果浏览器未唤起 Loon，请复制以下 Raw 地址，然后在 Loon 的「配置 → 插件」中手动添加：

```text
https://raw.githubusercontent.com/vulpsecula/BiliBili-CDN-Loon/main/custom/BiliBili.Redirect.CCBStyle.plugin
```

Loon 需要 `3.5.0(969)` 或更高版本，并需要安装、信任 MITM 证书。还需要在 Loon 的 **MitM → QUIC 回退保护** 中开启该选项；插件不再额外维护重复的 QUIC `REJECT` 规则。这样当 QUIC 连接的 SNI 命中本插件的 MitM hostname 时，由 Loon 自身负责拒绝 QUIC 并促使客户端回退到可被 HTTP/MITM 脚本处理的连接。

## 手动模式

`目标 CDN 节点` 始终保留。关闭 `⚡ 自动测速` 后，手动节点拥有最高优先级：

1. 如果命中 JSON playurl，插件会提前把 DASH `baseUrl/base_url/backupUrl/backup_url` 和传统 `durl` 改到手动节点；
2. 后续匹配 `/upgcxcode/` 的 CDN 请求仍会由 request fallback 改到同一个手动节点。

自动测速不会修改 `[Argument]` 中的手动选择。你可以随时关闭自动测速，立即恢复到所选节点。

## 自动模式

开启 `⚡ 自动测速` 后，每条媒体请求按下面顺序处理：

```text
当前网络 + 当前 CDN family 的 6 小时缓存
        ↓ 没有
同 family 真实视频吞吐测试
        ↓ 失败 / 已有测速任务
手动选择的目标 CDN
```

缓存和测速按 CDN family 分开。例如同一个 Wi-Fi 下可以同时保存：

```text
cos     → upos-sz-mirrorcosov.bilivideo.com
akamai  → upos-hz-mirrorakam.akamaized.net
ali     → ...
```

因此 COS 与 Akamai 分片交替出现时不会互相覆盖缓存，也不会反复触发测速。

## playurl response hook

插件监听常见 JSON 播放接口，包括普通视频、番剧和 PUGV 的 `playurl` 路径。

### 手动模式

playurl 命中后会直接修改 DASH/durl 媒体 URL，让播放器在发起分片请求前就使用手动 CDN。

### 自动模式

playurl hook **不再主动测速**。它只做两件事：

- 某个媒体 URL 的 family 已经有当前网络的有效缓存：提前应用该 family 的缓存 CDN；
- 没有缓存：保持原 URL 不变，让随后真正的 CDN request fallback 用这条 signed URL 触发统一测速。

这样自动模式只有一套测速算法和一份 family cache。

部分 Bilibili App 可能使用 protobuf / gRPC 播放接口，JSON playurl hook 不一定触发；这种情况下 request fallback 仍然可以独立工作。

## CDN request fallback

插件监听常见 Bilibili 视频 `/upgcxcode/` 请求，包括：

- `*.bilivideo.com`
- `*.bilivideo.cn`
- `*.acgvideo.com`
- 插件列出的 Akamai UPOS 地址

你当前看到的 `CDN 请求 fallback` 日志就是这条路径。

请求改写只替换 scheme / hostname / port，保留原始视频 path、签名 query 和其他参数。

## 自动测速算法

测速思路参考 Bilibili Accelerator：优先比较真实视频数据传输能力，而不是只按 DNS、TCP/TLS 或 TTFB 延迟排序。

### 1. 同 family 小候选池

request fallback 手里通常只有当前这一条 signed URL，因此不会再拿一个 COS signed URL 去测试 Ali、HW 或全国 regional 节点。

只比较与当前 signed URL family 匹配的小候选池，并始终把原始 CDN 作为 baseline。例如常见 COS 请求会比较：

```text
原始 COS CDN
upos-sz-mirrorcosb.bilivideo.com
upos-sz-estgcos.bilivideo.com
upos-sz-mirrorcosov.bilivideo.com
```

重复节点会自动去重。

COS、Ali、HW、08 与 regional 当前各配置 3 个经过全量粗筛验证的静态候选。regional 分别选取香港、山东和湖北节点以增加线路覆盖；其他 family 仍严格按签名类型分组，不能仅按地区混用。加上当前请求的原始 CDN 后，每次实际测速最多 4 个节点。

Akamai 当前没有第二个自动候选时，会把原始节点作为单候选静默直通并缓存 6 小时，不执行无意义的测速。

### 2. 全量首测

同 family 的所有候选使用相同测试条件。脚本会按当前网络选择流量档位：

- Wi-Fi：每个候选读取 `512 KiB`；
- 蜂窝或无法识别 SSID：每个候选读取 `384 KiB`；
- 单节点最长约 `4 s`；
- 最多 4 个候选同时开始，避免第 4 个节点因排队而获得不同的网络条件；
- `$httpClient` 显式使用 `DIRECT`；
- 只接受 `206 Partial Content`，避免不遵守 Range 的节点把完整视频缓冲进移动端内存；
- 按实际收到的数据量 / 请求耗时计算 Mbps。

首测样本用于预热连接并给全部候选一次参与排名的机会；更大的确认样本用于降低慢启动和短时抖动对最终选择的影响。

### 3. 瞬时失败重试

只有首测不足两个可用节点时，DNS、timeout 或其他连接类异常节点才会最多重试一次：

- 使用与当前网络首测相同的样本大小；
- 单节点最长约 `4 s`；
- 单并发；
- 如果手动 fallback 节点在重试列表中，会优先重试。

如果首测已经得到至少两个可用节点，会跳过失败重试，把时间和流量预算留给 Top 2 确认。HTTP 明确拒绝等非瞬时错误不会重试。仅在重试中成功的节点排在首测成功节点之后，避免一次偶然恢复直接夺得第一。

### 4. Top 2 串行确认

如果首测/重试完成后至少有两个可用节点，而且 12 秒总预算还剩至少约 7.2 秒，会对 Top 2 再做一次串行确认：

- Wi-Fi 每个节点 `1 MiB`，蜂窝网络每个节点 `768 KiB`；
- 每个节点最长约 `3.5 s`；
- 严格单并发，避免两个候选同时抢同一网络带宽。

确认成功节点按 `70% 确认吞吐 + 30% 首测吞吐` 排序，兼顾持续带宽和首轮表现。确认失败的节点会降到未确认的后备节点之后；如果只有一边确认成功，则该节点优先。这样不会让一次短首测的高峰值压过更稳定的候选。

### 5. 总预算

一次无缓存测速有约 `12 s` 总预算。剩余时间不足时会跳过 Top 2 确认，为原始媒体请求和 Loon 的 30 秒脚本上限保留余量。

## 缓存

自动结果按下面的组合独立缓存 6 小时：

```text
Wi-Fi SSID / cellular 标识
+ Loon running_model
+ CDN family
```

因此：

- 同一网络、同一 family 后续播放直接复用；
- 换 Wi-Fi 后会为新网络重新学习；
- Loon 运行模式变化会使用不同网络 key；
- 首次遇到新的 family 会只为该 family 建立缓存；
- 每个 family 会保存静态候选池指纹；候选增删或替换后，该 family 的旧缓存自动失效；
- 测速引擎版本升级时旧 engine cache 会自动失效一次。

## 通知

自动测速完成并不意味着一定弹通知。

只有最终选择的 CDN 与当前原始 CDN 不同时才可能通知；另外同一网络有 5 分钟通知冷却。原 CDN 本身已经最快、单候选直通、或者处于冷却期时都会静默。

## 查看测速状态 / 结果

插件提供 Generic Script：

```text
📊 查看 CDN 测速状态 / 结果
```

它不会主动测速，只读取当前状态和缓存。重点字段包括：

- `最近实际请求：family → CDN`：最后一条真实媒体请求最终用了哪个节点；
- `cos/akamai/... 自动选择`：各 family 当前独立缓存；
- `最近测速 family / 最近测速选中`：最近一次真正执行测速的 family 和赢家；
- 首测、重试、串行确认的成功数量；
- DNS、timeout、HTTP 等失败诊断；
- 完整排名与失败列表会写入日志/通知剪贴板。

`最近实际请求` 和 `最近测速选中` 可以属于不同 family，这不是冲突。例如最后一条分片恰好是 Akamai，但最近一次真正测速的是 COS。

## 直连与代理

- 视频请求最终经过哪个 Loon 策略，仍由你的 Loon 运行模式和规则决定；
- 当前**测速探针显式使用 `DIRECT`**，这是为了让探测路径稳定、避免策略组切换给排名引入额外变量；
- 因此如果你以后专门让 Bilibili 视频走代理，测速结果代表的是直连 CDN 表现，不等同于代理路径表现。

## 节点列表

插件的手动下拉当前保留 2026-08-29 使用 `BV1eL4k6jEjd` 全量持续带宽粗筛中成功返回媒体数据的 197 个节点。该次测试中 DNS、无路由、连接/读取超时及 HTTP 302/4xx/5xx 的节点已从列表移除；Akamai 域名未包含在这次 491 个 `.bilivideo.com` 节点测试中，因此也不列入“已验证成功”的手动候选。

这个列表是一次特定网络、视频资源和时间点的可用性快照，不代表失败节点永久不可用。自动测速不会把 197 个手动节点全部逐个测试，只使用代码中明确的小 family 候选池。

## 注意事项

- 不要同时启用其他会修改同一批 Bilibili playurl 或 `/upgcxcode/` 请求的 CDN 插件，否则结果取决于脚本执行顺序；
- 必须开启 Loon 的 `MitM → QUIC 回退保护`。本插件不再添加独立 QUIC `REJECT` 规则，QUIC 降级统一交给 Loon 的原生机制；
- 自动测速不会把视频 URL 或测速结果上传到本项目服务器；
- CDN、播放接口和签名策略都可能变化。如果出现问题，优先查看 `📊 查看 CDN 测速状态 / 结果` 和 request script 日志中的 `✅ 实际使用 CDN`。

## 与上游的关系

本分支与插件为非官方修改，不隶属于 BiliUniverse、CCB、Bilibili 或 Bilibili Accelerator。

- Based on [BiliUniverse/Redirect](https://github.com/BiliUniverse/Redirect)
- CDN list based on [Kanda-Akihito-Kun/ccb](https://github.com/Kanda-Akihito-Kun/ccb)
- Auto speed-test approach inspired by [realzza/bilibili-accelerator](https://github.com/realzza/bilibili-accelerator)

原项目授权条款见各自仓库。