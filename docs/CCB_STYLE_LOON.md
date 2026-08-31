# CCB Style for Loon

这是 `BiliUniverse/Redirect` 的非官方 Loon 扩展，用于把 Bilibili 普通视频 CDN 重定向到手动选择或自动测速得到的节点。

当前运行结构只有一套自动测速引擎：

- **playurl response hook**：解析 JSON DASH/durl。手动模式可提前改写媒体 URL；自动模式只应用已经存在的有效 family 缓存。
- **CDN request fallback**：负责自动测速、最终 CDN 选择和真实 `/upgcxcode/` 请求改写，是自动模式唯一的测速引擎。
- **Generic Scripts**：`📊 查看 CDN 测速状态 / 结果` 只读状态；`🎯 测试当前 CDN 持续带宽` 只做单节点手动长测，不修改自动选择。

## 安装要求

Loon 需要 `3.5.0(969)` 或更高版本，并需要安装、信任 MITM 证书。

还必须开启：

```text
MitM → QUIC 回退保护
```

插件不再额外维护 QUIC `REJECT` 规则；命中本插件 MitM hostname 的 QUIC/HTTP3 流量由 Loon 原生机制负责回退到可被 HTTP/MITM 脚本处理的连接。

## 插件参数

### 目标 CDN 节点

关闭 `⚡ 自动测速` 时始终使用该节点。自动测速失败或已有测速任务占用锁时，也会把它作为 fallback。

### ⚡ 自动测速

关闭时完全服从手动节点；开启时按当前网络和 CDN family 使用自动缓存，缓存失效时由真实视频请求触发同 family 吞吐测速。

### 🎞 测试视频 BV号

仅供 `🎯 测试当前 CDN 持续带宽` 使用。默认：

```text
BV1eL4k6jEjd
```

可改成任意公开 Bilibili 视频 BV 号。每次运行手动长测时都会重新请求该视频的 playurl，以获取新的 signed media URL。

### ⏱ 单轮测速秒数

仅供手动长测使用。默认 `6` 秒，实际限制在 `3–10` 秒，固定测试 3 轮。

## 手动模式

关闭 `⚡ 自动测速` 后：

1. JSON playurl 命中时，DASH `baseUrl/base_url/backupUrl/backup_url` 与传统 `durl` 会提前改到手动 CDN；
2. 后续匹配 `/upgcxcode/` 的真实 CDN 请求仍由 request fallback 改到同一个节点。

自动测速不会修改插件里的手动选择。

## 自动模式

每条真实媒体请求按以下顺序处理：

```text
当前网络 + 当前 CDN family 的有效缓存
        ↓ 没有
同 family 真实视频吞吐测试
        ↓ 失败 / 测速锁被占用
手动选择的 CDN fallback
```

缓存按 family 分开，因此同一个网络可以同时存在：

```text
cos     → ...
akamai  → ...
ali     → ...
```

COS 与 Akamai 分片交替出现不会互相覆盖缓存。

## 自动测速算法

request fallback 使用当前真实视频 signed URL，只比较同 signature family 的小候选池，并始终把原始 CDN 作为 baseline。

当前主要 family：COS、Ali、HW、08、regional。Akamai、MCDN 等没有额外自动候选时，会保持原始节点单候选直通并缓存，不做无意义的跨 family 排名。

### 全量首测

最多 4 个候选同时开始：

- Wi-Fi：每个 `512 KiB`；
- 蜂窝/未知 SSID：每个 `384 KiB`；
- 单请求最长约 `4 s`；
- `$httpClient` 显式使用 `DIRECT`；
- 只接受 `206 Partial Content`；
- 按实际收到的 bytes / elapsed time 计算 Mbps。

### 失败重试

只有首测不足两个成功节点时，DNS、timeout 和其他连接类瞬时失败才低并发重试一次。首测已有至少两个成功节点时，会把剩余时间留给 Top 2 确认。

### Top 2 串行确认

预算充足时，对首测 Top 2 串行复测：

- Wi-Fi：每个 `1 MiB`；
- 蜂窝：每个 `768 KiB`；
- 单并发；
- 确认结果和首测结果加权排序。

自动测速总预算约 `12 s`，结果按 `网络 + running_model + family` 缓存 6 小时。候选池指纹或 engine version 变化会使对应旧缓存失效。

## 🎯 当前 CDN 持续带宽测试

这是用户主动触发的**单节点精测**，不会重新选择 CDN，也不会写入自动测速 family cache。

### 测哪个节点

- 自动模式：优先测试最近实际请求使用的 CDN；没有最近请求时取最新 family 缓存；
- 手动模式：直接测试当前手动节点。

### 测试视频

使用插件参数 `🎞 测试视频 BV号`。脚本调用 Bilibili API 获取该视频当前有效的 playurl 和 signed media URL，并优先寻找与目标 CDN 相同 family 的 donor。

如果找不到同 family donor，会明确标记“跨 family”，这种结果只作为参考。

### 测试方法

桌面参考脚本 `scripts/bili_cdn_bandwidth.py` 可以流式读取并丢弃前段数据；Loon `$httpClient` 只能在完整响应结束后回调，因此移动端不能原样复制按时间窗口读取。

当前手动长测采用：

```text
获取新鲜 signed URL
      ↓
预热 Range（不计分）
      ↓
校准 Range（不计分）
      ↓
根据校准速度决定单次 Range 块大小
      ↓
Round 1：连续串行 Range，直到目标秒数/流量上限
Round 2：连续串行 Range，直到目标秒数/流量上限
Round 3：连续串行 Range，直到目标秒数/流量上限
      ↓
中位数 + 最低/最高 + 稳定度
```

连续请求会轮换 Range offset，并发送 `Cache-Control: no-cache`，减少重复读取同一小片段造成的本地缓存干扰。每个网络请求仍单独受控，避免一次把几十 MiB 响应完整缓冲进内存。

### 默认参数

单轮目标默认 `6 s`，可在插件中改为 `3–10 s`。

Wi-Fi：

- 预热 `1 MiB`；
- 校准 `2 MiB`；
- 单个 Range 块自适应在约 `1–8 MiB`；
- 每轮总流量最多 `64 MiB`。

蜂窝：

- 预热 `512 KiB`；
- 校准 `1 MiB`；
- 单个 Range 块自适应在约 `512 KiB–4 MiB`；
- 每轮总流量最多 `20 MiB`。

如果高速节点先碰到单轮流量上限，该轮会提前结束并在结果中显示“达流量上限”。因此手动长测是“目标时间 + 流量保护”的折中，而不是无限制下载。

结果会显示实际节点与 family、测试 BVID、每轮 Mbps、实际 MiB / 秒数 / Range 次数、三轮中位数、最低/最高、稳定度，以及总测试流量和总耗时。

手动长测显式使用 `DIRECT`，不会修改自动测速缓存、6 小时选择结果或当前 CDN。

## CDN request fallback 覆盖

当前匹配常见 Bilibili 视频 `/upgcxcode/`：

- `*.bilivideo.com`
- `*.bilivideo.cn`
- `*.acgvideo.com`
- 插件列出的 Akamai UPOS host

请求改写只替换 scheme / hostname / port，保留原始 path、signed query 和其他参数。

## 查看状态

`📊 查看 CDN 测速状态 / 结果` 不主动测速，只读取当前缓存和状态。重点字段包括最近实际请求、每个 family 的自动选择、最近测速 winner、首测/重试/串行确认成功数，以及 DNS、timeout、HTTP 等失败诊断。

## 直连与代理

自动测速和手动长测的探针均显式使用 `DIRECT`，因此结果反映直连 CDN 路径。如果你让 Bilibili 视频实际走代理，测速结果不等于代理路径带宽。

## 手动节点列表

插件手动下拉保留最近一次全量持续带宽测试中成功返回媒体数据的 CCB 节点。它是特定网络、时间和视频资源下的可用性快照，不代表未保留节点永久不可用。

自动测速不会遍历整个手动下拉，只使用代码中明确的小 family 候选池。

## 注意事项

- 不要同时启用其他修改同一批 Bilibili playurl 或 `/upgcxcode/` 请求的固定 CDN 插件；
- 必须开启 Loon 的 `MitM → QUIC 回退保护`；
- 手动持续带宽测试会产生明显真实视频流量，特别是 Wi-Fi 高带宽节点和较长 `单轮测速秒数` 设置；
- CDN、播放接口和签名策略可能变化，异常时优先查看 request script 日志和两个 Generic Script 输出。

## 与上游的关系

本分支与插件为非官方修改，不隶属于 BiliUniverse、CCB、Bilibili 或 Bilibili Accelerator。

- Based on [BiliUniverse/Redirect](https://github.com/BiliUniverse/Redirect)
- CDN list based on [Kanda-Akihito-Kun/ccb](https://github.com/Kanda-Akihito-Kun/ccb)
- Auto speed-test approach inspired by [realzza/bilibili-accelerator](https://github.com/realzza/bilibili-accelerator)

原项目授权条款见各自仓库。
