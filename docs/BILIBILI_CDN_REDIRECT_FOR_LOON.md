# BiliBili CDN Redirect for Loon

这是基于 [Biliverse/Redirect](https://github.com/Biliverse/Redirect) 的非官方 **Loon 专用** Bilibili CDN 重定向插件。它提供固定 CDN、按 CDN family 自动选择、当前节点持续带宽测试和状态诊断。

## 快速开始

1. 使用 README 中的“一键导入 Loon”安装插件。
2. 安装并信任 Loon MitM 证书。
3. 为确保 QUIC/HTTP3 视频流量也能进入 MitM / Script，开启：
   ```text
   MitM → QUIC 回退保护
   ```
4. 在插件设置中选择一个 **目标 CDN 节点**。
5. 固定节点时关闭 `⚡ 自动选择节点`；需要自动选择时打开它。
6. 正常播放一个 Bilibili 视频。
7. 运行 `📊 查看自动选择节点结果` 检查当前状态；如果要做单节点精测，先播放几秒，再运行 `🎯 测试当前 CDN 持续带宽`。

自动模式首次遇到当前网络下尚未缓存的 CDN family 时，会使用当前真实视频请求进行一次小样本吞吐测试；单轮自动测速总预算约 12 秒。成功结果按 **网络 + running_model + family** 缓存 6 小时，因此后续请求通常直接使用缓存。

## 安装要求

- Loon **3.5.1 (983)+**
- 已安装并信任 MitM 证书
- 为接管 QUIC/HTTP3 视频流量，开启 **MitM → QUIC 回退保护**
- 不要同时启用其他修改同一批 Bilibili playurl 或 `/upgcxcode/` 请求的固定 CDN 插件

插件支持 iOS、iPadOS、macOS，并已声明 tvOS。tvOS 当前属于**初步支持**：Loon 脚本层已适配，但 Bilibili Apple TV 客户端的全部 host/path 仍需要更多实机验证。

## 从旧版本升级

从 **1.9.0** 起，项目统一使用 **BiliBili CDN Redirect for Loon** 命名：

```text
custom/BiliBili.CDN.Redirect.Loon.plugin
custom/BiliBili.CDN.Redirect.Loon.request.js
custom/BiliBili.CDN.Redirect.Loon.response.js
custom/BiliBili.CDN.Redirect.Loon.bandwidth.js
custom/BiliBili.CDN.Redirect.Loon.result.js
```

旧 Raw 插件地址不再维护。若你使用的是 1.8.x 或更早版本，建议：

1. 停用或删除旧插件条目；
2. 使用 README 中当前的一键导入链接重新安装；
3. 重新确认插件参数；
4. 正常播放一个视频，让自动选择状态和最近真实播放样本重新建立。

1.9.0 同时更新了 PersistentStore namespace，所以旧自动选择缓存不会被继续读取，这是预期行为。

## 插件参数

### 目标 CDN 节点

关闭 `⚡ 自动选择节点` 时始终使用该节点。

自动模式下，它仍然是安全 fallback：如果测速失败、当前测速锁被其他请求占用，或者无法取得有效自动结果，就回退到这里选择的节点。

地区分隔项只用于下拉列表视觉分组，不应作为实际 CDN 选择。

### ⚡ 自动选择节点

关闭时完全服从手动 CDN。

开启后，每条真实媒体请求会先检查当前 **网络 + running_model + CDN family** 是否已有有效缓存：

```text
有效 family 缓存
      ↓ 有
直接使用缓存 CDN

      ↓ 没有
同 family 真实视频吞吐测试
      ↓
成功：缓存 6 小时
失败 / 锁占用：回退手动 CDN
```

自动选择不会修改插件设置里的手动 CDN 选项。

### 🎞 测试视频 BV号

只用于 `🎯 测试当前 CDN 持续带宽` 在**没有近期真实播放样本**时的 fallback。

默认：

```text
BV1eL4k6jEjd
```

正常情况下，手动长测优先使用最近 30 分钟内真实播放产生的 signed media URL，不需要请求这个 BV 的网页。

### ⏱ 单轮测速秒数

只用于用户主动触发的当前 CDN 持续带宽测试。

- 默认：`6` 秒
- 可设置范围：`3–10` 秒
- 固定：3 轮正式测试

## 常用模式

### 手动模式

关闭 `⚡ 自动选择节点` 后：

1. playurl JSON 响应命中时，DASH `baseUrl/base_url/backupUrl/backup_url` 与传统 `durl` 会提前改到手动 CDN；
2. 后续真实 `/upgcxcode/` CDN 请求仍由 request fallback 再次确保使用同一节点。

这种双层处理提高不同 Bilibili 客户端和播放接口下的兼容性。

### 自动模式

自动模式只保留**一套测速引擎**：真实 CDN request fallback。

playurl response hook 不会另外启动测速；它只会：

- 如果已有对应 family 的有效缓存，提前把媒体 URL 改到缓存节点；
- 如果没有缓存，保持原 URL，等待真实 CDN request 触发测速。

缓存按 family 独立，因此同一个网络可以同时存在：

```text
cos     → ...
ali     → ...
hw      → ...
08      → ...
regional → ...
akamai  → 原始节点直通
```

Akamai、MCDN 等当前没有额外自动候选池的 family，会保持原始 CDN 单候选直通，不做无意义的跨 family 排名。

### 📊 查看自动选择节点结果

这个 Generic Script **不会主动测速**。它只读取当前网络对应的缓存和状态，包括：

- 自动选择是否开启
- 手动 fallback CDN
- 最近实际请求
- 已缓存的 family
- 最近 winner / Mbps
- 首测、重试、Top 2 确认统计
- DNS、timeout、HTTP 等失败诊断

### 🎯 测试当前 CDN 持续带宽

这是用户主动触发的**单节点精测**。它不会重新选择 CDN，也不会写入自动测速 family cache。

推荐顺序：

```text
先正常播放视频几秒
        ↓
保存最近真实 signed URL + 安全请求头
        ↓
运行「测试当前 CDN 持续带宽」
        ↓
预热 → 校准 → 3 轮持续 Range 测试
```

#### 测哪个节点

- 自动模式：优先测试最近实际请求使用的 CDN；没有最近请求时取最新有效 family 缓存
- 手动模式：直接测试当前手动 CDN

#### donor 获取顺序

单节点测速现在按目标 CDN family 优先寻找兼容 donor：

1. 最近 30 分钟内的**同 family 真实视频请求**；
2. 最近 playurl 响应保存的**同 family signed URL**，并尽量复用最近真实播放的安全请求头；
3. 如果没有同 family donor，才使用最近真实视频请求作为**跨 family fallback**；
4. 如果没有近期真实 donor，尝试配置 BV 的普通网页并读取 `window.__playinfo__`；
5. 跨 family donor 在目标节点预检失败时，也会额外尝试一次配置 BV 的同 family URL。

不调用旧的 `/x/web-interface/view` / `/x/player/playurl` donor 链路。

因此，**正常使用时仍建议先播放视频再测速**。Bilibili 普通网页 fallback 有可能直接返回 HTTP 412。

#### 测试方法

Loon `$httpClient` 只能在完整响应结束后回调，不能像桌面流式客户端那样持续读取后随时截断。所以移动端采用多个受控 Range 请求来逼近持续带宽测试：

```text
获取优先同 family 的 signed URL
      ↓
轻量预检 Range（不计分）
      ↓
校准 Range（不计分）
      ↓
按校准速度决定单次 Range 大小
      ↓
Round 1：串行 Range
Round 2：串行 Range
Round 3：串行 Range
      ↓
中位数 + 最低/最高 + 稳定度
```

每轮持续到目标时间或流量上限，Range offset 会轮换，并使用 `Cache-Control: no-cache` 减少反复命中相同小片段缓存的影响。

默认参数：

| 网络 | 轻量预检 | 校准 | 单次 Range | 每轮上限 |
| --- | ---: | ---: | ---: | ---: |
| Wi-Fi | 256 KiB / 10 s | 1 MiB / 12 s | 约 256 KiB–8 MiB | 64 MiB |
| 蜂窝 | 128 KiB / 10 s | 512 KiB / 12 s | 约 256 KiB–4 MiB | 20 MiB |

如果高速节点先碰到流量上限，该轮会提前结束并标记“达流量上限”。

## 故障排查

| 现象 | 含义 / 建议 |
| --- | --- |
| 播放视频但完全没有 request script 日志 | 先确认 MitM 证书已信任、插件已启用、QUIC 回退保护已开启，并确认没有其他插件抢先改写相同请求 |
| `📊 查看自动选择节点结果` 一直显示等待触发 | 先播放一个普通视频几秒。只有匹配到受支持媒体请求后，request fallback 才会写入状态 |
| 单节点测速一开始出现网页 HTTP 412 | 当前没有可用的近期真实播放样本，脚本进入 BV 网页 fallback，而网页被 Bilibili 风控拒绝；先正常播放视频几秒后再测速 |
| 预检 timeout / HTTP 403 / 其他 HTTP 错误 | 轻量预检失败后都会用同一 signed URL 对照测试 donor 原始 host，不再只对 403 做诊断 |
| 目标节点失败，但原始 host 成功 | donor 本身有效；目标 CDN 当前不可用、当前直连路径异常，或跨 host / 跨 family 请求不被接受 |
| 目标节点和原始 host 都失败 | signed URL 可能已过期，或当前网络 / 请求条件异常；重新播放视频生成新样本后立即测试 |
| 自动模式第一次播放感觉比之后慢 | 未缓存 family 可能触发一次自动测速；成功后该 family 在当前网络下缓存 6 小时 |
| tvOS / Apple TV 没有命中脚本 | tvOS 当前是初步支持；如果证书与 QUIC 设置正常但没有命中，Bilibili TV 可能使用了尚未覆盖的 host/path，需要根据实际日志补匹配 |
| 测速值和代理下载速度不一致 | 自动测速与手动长测都显式使用 `DIRECT`，测的是直连 CDN 路径 |

## 工作原理

### playurl response hook

插件会处理已覆盖的 Bilibili playurl JSON 响应并递归寻找：

- DASH `baseUrl` / `base_url`
- DASH `backupUrl` / `backup_url`
- 传统 `durl.url`
- 传统 `durl.backup_url` / `backupUrl`

手动模式可以直接改写这些 URL；自动模式只应用已有有效 family cache。

### CDN request fallback

这是自动模式唯一的测速引擎，也是最终请求改写层。

当前匹配常见 `/upgcxcode/`：

- `*.bilivideo.com`
- `*.bilivideo.cn`
- `*.acgvideo.com`
- `upos-hz-mirrorakam.akamaized.net`
- `upos-sz-mirrorakam.akamaized.net`
- `upos-bstar1-mirrorakam.akamaized.net`

请求改写保留原始 path、signed query 和其他参数，主要替换 scheme / hostname / port，并同步相关 Host / authority 信息。

当前没有把上游所有 MCDN / PCDN 特殊端口和特殊 path 逻辑直接合入；这类流量后续会按 Loon 的实际客户端需求单独适配。

### 自动测速算法

request fallback 使用当前真实视频 signed URL，只比较同 signature family 的小候选池，并始终把原始 CDN 作为 baseline。

当前有多候选自动比较的主要 family：

- COS
- Ali
- HW
- 08
- regional

首测：

- 最多 4 个候选同时开始
- Wi-Fi：每个 512 KiB
- 蜂窝 / 未识别 SSID：每个 384 KiB
- 单请求最长约 4 秒
- `$httpClient` 显式使用 `DIRECT`
- 只接受 `206 Partial Content`
- 按实际收到的 bytes / elapsed time 计算 Mbps

失败重试：

- 只有首测不足两个成功节点时，才对 DNS、timeout 等连接类瞬时失败低并发重试一次
- 首测已有至少两个成功节点时，会把剩余预算优先留给 Top 2 确认

Top 2 串行确认：

- Wi-Fi：每个 1 MiB
- 蜂窝：每个 768 KiB
- 单并发
- 确认结果与首测结果加权排序

自动测速总预算约 12 秒。候选池指纹或内部 engine version 变化时，对应旧缓存会自动失效。

## 隐私与网络行为

### 最近真实播放样本

为了让单节点持续带宽测试尽量复现真实播放环境，插件会在 PersistentStore 中按网络和 family 临时保存最近 donor：

- request script 保存最近真实媒体请求的 signed URL 与一组非敏感 headers
- response script 保存 playurl 中不同 family 的原始 signed URL
- 当前网络与最近 CDN 状态

保存 headers 时会主动排除或拒绝持久化：

- `Cookie`
- `Authorization` / `Proxy-Authorization`
- 名称包含 `credential`、`session`、`token` 的字段
- `Host` / `:authority`
- `Range`、`Content-Length`、`Accept-Encoding`
- 连接控制字段和插件自己的内部测速 header

最近真实 signed URL 只作为本地 Loon PersistentStore 中的测速 donor，不会被上传到本项目或其他服务。

### DIRECT

自动测速和手动持续带宽测试中的 `$httpClient` 探针均显式使用 `DIRECT`。因此：

- 测速反映的是设备到 CDN 的直连路径；
- 如果实际视频被你的其他规则送进代理，测速值不代表代理路径；
- 手动持续带宽测试会产生明显真实视频流量。

## 手动节点列表

当前下拉列表保留的是 **2026-08-29** 全量持续带宽测试中成功返回媒体数据的节点。

这只是特定时间、网络和视频资源下的可用性快照：

- 列表中的节点未来仍可能失效或变慢；
- 未保留节点不代表永久不可用；
- 自动选择不会遍历整个下拉列表，只使用代码中明确的小型 family 候选池。

如需在桌面环境重新评估完整 CCB 节点，可以使用：

```text
scripts/bili_cdn_bandwidth.py
```

详见 [scripts/README.md](../scripts/README.md)。

## 上游与来源

本项目是非官方 fork，不隶属于 Biliverse、CCB、Bilibili 或 Bilibili Accelerator。

- Based on [Biliverse/Redirect](https://github.com/Biliverse/Redirect)
- CDN list based on [Kanda-Akihito-Kun/ccb](https://github.com/Kanda-Akihito-Kun/ccb)
- Auto speed-test approach inspired by [realzza/bilibili-accelerator](https://github.com/realzza/bilibili-accelerator)

授权条款见仓库根目录 [LICENSE](../LICENSE)。
