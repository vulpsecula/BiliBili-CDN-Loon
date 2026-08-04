# CCB Style for Loon

这是 `BiliUniverse/Redirect` 的非官方 Loon 扩展：它不等待 Bilibili 选择 CDN，而是把命中 `/upgcxcode/` 的普通视频请求强制改写到你在插件参数中选定的节点。

## 安装

在 Loon 中订阅以下 Raw 地址：

```text
https://raw.githubusercontent.com/vulpsecula/BiliBili-CDN-Loon/main/custom/BiliBili.Redirect.CCBStyle.plugin
```

如果你正在测试 PR 分支，请把 URL 中的 `main` 替换为对应分支名。合并回 `main` 后再改回上述地址。

## 使用

1. 启用插件，并在插件参数中选择目标 CDN。
2. 安装并信任 Loon MITM 证书，确认 MITM 已启用。
3. 确保 Bilibili 流量能按你的 Loon 策略正常连接。
4. 播放视频并对比速度；若节点不稳定，切换其他参数后重试。

默认节点是 `cn-hk-eq-01-01.bilivideo.com`。节点效果取决于所在地、运营商和当时网络，并不存在对所有人都最快的固定选项。

## 自动分流与直连

- 「自动分流」决定请求由哪个 Loon 策略出口连接，例如直连、某个代理节点或策略组。
- 「直连」只是其中一种出口决策，表示不经过代理服务器。
- 本插件负责改写视频 CDN 主机名，不代替你的分流规则。改写后的请求仍会按 Loon 的规则选择直连或代理出口。

## 注意事项

- 不要同时启用其他会改写同一批 `/upgcxcode/` 请求的固定 CDN 插件，否则结果取决于重写顺序。
- 规则仅对相关视频域名拒绝 QUIC，使请求回退到可被 HTTP 重写和 MITM 处理的连接。
- 请求路径、查询参数、签名与 `Range` 请求头由 Loon 的 header rewrite 保留；插件只替换 scheme/hostname 和命中的路径前缀。
- CDN 列表或 Bilibili 的请求形式可能随时变化，失效时请停用插件并回报具体请求域名。

## 与上游的关系

本分支与插件为非官方修改，不隶属于 BiliUniverse 或 CCB。

- Based on [BiliUniverse/Redirect](https://github.com/BiliUniverse/Redirect)
- Inspired by [Kanda-Akihito-Kun/ccb](https://github.com/Kanda-Akihito-Kun/ccb)

当前 Loon 实现是配置层的 header rewrite，未直接复制 CCB 的浏览器 Hook 代码。原项目授权条款见仓库根目录的 `LICENSE`。
