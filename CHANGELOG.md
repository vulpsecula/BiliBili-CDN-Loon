### 🔬 Loon CDN 节点验证
  * 手动 CDN 列表由 492 个候选缩减为 197 个在 2026-08-29 全量持续带宽测试中可请求成功的节点。
  * 移除自动 regional 候选池中本轮失败的广东与上海节点，并升级测速引擎版本以使旧缓存失效。

### 🛠️ Bug Fixes
  * 补充 Equinix IX CDN 主机名 by @ltysbc

### 🔣 Dependencies
  * 升级了 `@nsnanocat/grpc`
  * 升级了 `@nsnanocat/util`
    * 新增`[储存] 配置类型 (Storage)`选项，提供如下三个选项，其中 `Argument` 为默认选项：
      * `Argument`: 优先使用来自`插件选项`与`模块参数`等，由 `$argument` 传入的配置，`$argument` 不包含的设置项由 `PersistentStore (BoxJs)` 提供。 
      * `PersistentStore`: 只使用来自 `BoxJs` 等，由 `$persistentStore` 提供的配置；
      * `database`: 只使用由作者的 `database.mjs` 文件提供的默认配置，其他任何自定义配置不再起作用。
      * `未选择/未填写`： 配置优先级依旧是 `$persistentStore (BoxJs)` > `$argument` > `database`
    * ⚠️ 注意：`[储存] 配置类型 (Storage)`选项只能经由 `$argument` 进行配置，可通过支持 `$argument` 的插件选项或模块参数进行设置。对于本就不支持 `$argument` 的 app (如 Quantumult X)，始终按照 `未选择/未填写` 模式进行处理（与旧版逻辑一致）。

### 🆕 New Features
  * `重定向 OverseaVideo CDN (港澳台)`选项新增重定向以下主机名：
    * `cn-hk-eq-01-01.bilivideo.com` (Equinix IX CDN，香港)
    * `cn-hk-eq-01-03.bilivideo.com` (Equinix IX CDN，香港)
    * `cn-hk-eq-01-09.bilivideo.com` (Equinix IX CDN，香港)
    * `cn-hk-eq-01-10.bilivideo.com` (Equinix IX CDN，香港)
    * `cn-hk-eq-01-12.bilivideo.com` (Equinix IX CDN，香港)
    * `cn-hk-eq-01-13.bilivideo.com` (Equinix IX CDN，香港)
    * `cn-hk-eq-01-14.bilivideo.com` (Equinix IX CDN，香港)
