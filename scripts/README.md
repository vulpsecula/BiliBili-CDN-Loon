# 本地 CDN 持续带宽参考测速

[`bili_cdn_bandwidth.py`](bili_cdn_bandwidth.py) 是一个独立运行的参考脚本，用于从当前网络环境评估 CCB 节点的实际持续下载带宽。它不参与 Loon 插件运行，也不会修改 Loon 配置。

与插件内受运行时间和流量预算约束的小样本自动测速不同，本脚本会：

- 串行测试全部候选，避免节点之间争抢本地带宽；
- 丢弃预热阶段，降低 TCP/TLS 建连和慢启动对结果的影响；
- 对尾段仍在提速的节点自动延长粗筛窗口；
- 对候选节点进行三轮持续下载，按成功率、带宽中位数和最低一轮排序；
- 输出逐次样本、节点汇总和 Top N JSON，并保留失败原因。

## 运行

需要 Python 3.10 或更高版本。推荐使用 [`uv`](https://docs.astral.sh/uv/) 临时安装依赖：

```bash
uv run --with 'httpx[http2]' scripts/bili_cdn_bandwidth.py \
  --bvid BV1eL4k6jEjd \
  --top 10 \
  --output-prefix bili_cdn_test
```

也可以传入浏览器 Network 中复制的完整 Bilibili 媒体 URL：

```bash
uv run --with 'httpx[http2]' scripts/bili_cdn_bandwidth.py \
  --media-url 'https://example.bilivideo.com/path?...' \
  --top 10
```

查看全部参数：

```bash
uv run --with 'httpx[http2]' scripts/bili_cdn_bandwidth.py --help
```

## 注意事项

- 默认会从 CCB 的 `data/cdn.json` 获取完整节点表，并产生较多真实 CDN 下载流量，请勿高频运行。
- 测速结果只代表测试当时的本地网络、运营商路由、视频资源命中和 CDN 状态。
- 脚本默认把 `upos-sz-estgcos.bilivideo.com` 加入终测，用于观察慢启动及波动；可通过 `--no-default-pin` 关闭。
- 某些节点只接受特定路径、签名或区域请求，HTTP 403/404/302 不等于该节点永久离线。
