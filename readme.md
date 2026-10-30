<p align="center">
  <img src="build/appicon.png" alt="ESUI" width="160">
</p>

<h1 align="center">ESUI</h1>

<p align="center">Elasticsearch 桌面客户端。通过 REST API 与集群通信,支持 macOS、Windows、Linux。</p>

ESUI 用 [Wails](https://wails.io) 构建:Go 后端负责与 Elasticsearch 通信,前端是不需要构建的静态 HTML/CSS/JS,通过 Wails 绑定调用后端方法。

## 功能

侧栏分为三组:

- **概览**
  - 集群:保存多个连接,支持用户名密码、HTTPS、自定义 CA 证书、跳过证书校验,顶栏可随时切换
  - 节点、健康、指标:节点列表与资源占用、集群健康状态、`_cluster/stats` 统计指标
- **数据**
  - 索引:搜索、新建、删除、打开/关闭、Refresh、Flush、清理缓存、Force Merge;查看与修改 Mapping、Settings;别名管理;Reindex;按 DSL 导出为本地文件
  - 文档:DSL 分页检索、查看/编辑/删除单条文档、按查询批量删除、`_bulk` 批量导入、字段 Top 值统计
  - 模板:索引模板、组件模板、ILM 策略,以及基于模板创建索引
  - 分词:用指定分词器或字段测试文本的分词结果
- **运维**
  - REST:自由编写请求并查看响应
  - 诊断:分片列表、分片分配解释(Allocation Explain)、线程池、热点线程、挂起任务
  - Task:查看和取消运行中的任务
  - 快照:仓库管理、创建/删除/恢复快照、SLM 策略

另有深色/浅色主题(设置页切换)。界面语言为中文。

## 开发

需要:

- Go 1.25 或更高(见 `go.mod`)
- [Wails CLI v2](https://wails.io/docs/gettingstarted/installation):`go install github.com/wailsapp/wails/v2/cmd/wails@latest`
- 各平台的 Wails 系统依赖,可用 `wails doctor` 检查

前端是 `frontend/` 下的静态文件,由 `main.go` 中的 `//go:embed frontend` 打包进程序,不需要 Node 或构建步骤。

```bash
# 开发模式,修改前端文件后自动刷新
wails dev

# 打包,产物在 build/bin
wails build
```

Windows 下也可以直接运行 `dev.bat`。

打包时可以注入版本号:

```bash
wails build -ldflags "-X 'app/backend/common.Version=v1.0.0'"
```

## 目录结构

```
main.go, app.go     Wails 入口与应用生命周期
backend/
  common/           常量与版本号
  config/           配置文件读写(AppConfig)
  service/es.go     所有 Elasticsearch 请求(ESService)
  system/           更新检查
  types/            返回结构
frontend/
  index.html        入口,按顺序加载脚本
  css/              设计变量、基础样式、通用组件
  js/               核心、UI 组件、Wails 调用封装(api.js)、外壳(shell.js)
  pages/            每个页面一个 .js 和 .css
build/              应用图标、各平台打包配置
wails.json          Wails 项目配置
```

前端脚本是普通 `<script>`,不使用模块。后端调用统一走 `js/api.js` 中的 `ESUI.api`。生成的 Wails 绑定输出到 `build/wailsjs`。

## 配置

连接和设置保存在用户目录下的 `~/.es-king/config.yaml`。目录名沿用旧名称,是为了不丢失已有连接,请不要改名。

## 许可证

[Apache License 2.0](LICENSE)。本项目基于 Bronya0/ES-King 修改,源码文件头保留原作者版权声明。
