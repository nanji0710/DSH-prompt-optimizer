# 更新日志

本项目遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/) 规范，版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

## [0.2.0] - 2026-10-10

### 新增
- **本地优化引擎按 `docs/local-optimization-rules.md` 完整重写**：L0 清洗 / L1 结构 / L2 约束 / L3 角色四层共 24 条规则，每条带触发正则、守卫与反例。
- 端到端测试套件 `test/local-optimizer.test.mjs`（44 条用例，`npm test`），覆盖三条质量不变量：I1 幂等、I2 非空、I3 语义单调。
- 设置页新增「AI 接口」一节：优化模式、接口 / Provider、模型名称、采样温度，并展示宿主已注册的接口数量。
- 设置页「自定义角色」支持**新增**（此前只能删除），可填写角色名称、描述与专属优化提示词。
- 优化改走**真实 LLM 改写**：宿主侧通过 `ctx.llm.stream()` 调用 DSH 已接入的模型，支持 SSE 流式累加与多 provider 自动回退。

### 修复
- **输入框按钮不显示**：槽位对齐 DSH 真实契约（`conversation.input.right`，读草稿用 `props.useInput(s => s.draft)`，写回用 `props.inputActions.setDraft(text)`）。旧版用了不存在的 `composer.toolbar.model.before` 与 `useComposer()`。
- **设置页不显示**：修正设置节注册方式，设置页现可在 DSH 设置面板中正常出现并保存配置。
- **LLM 路径从未生效**：旧版调用的是不存在的 `llm.chat()`，导致 `if (!llm?.chat)` 恒真、永远只跑本地规则。已改为官方 `llm.stream()` 契约。
- **本地规则引擎 7 个 P0 缺陷**：`normalizeList` 用字符类做分隔符（把 `1.5 小时` 改成 `1. 5 小时`）、角色层丢失 `rolePrompt` 全文、`autoSplitParagraph` 拆散代码块、客套正则 `gim` 全行匹配删成空壳、全文件无行内代码保护、`splitSections` 生成空标题且不去重等。
- **Koa 短路导致 LLM 不工作**：优化路由从 `connection.rpc.handle()` 改为 `connection.fetch.register()`，绕开宿主 `owner.webServer` 影子 ctx 缺失问题。
- **序号归一累积空格**（违反幂等）：`"3. 最后重启"` 会被改成 `"3.  最后重启"` 且每跑一遍多一个空格。
- **L3 角色产物被二次改写**（违反幂等）：`looksStructured` 未识别 `【角色设定】`，导致注入角色的结果再跑一遍时 rolePrompt 被当成正文重排。
- `package.json` 的 4 个 `peerDependencies` 指向了不存在的包名（真名是 `dsh-client-ui-*`），现改为真实包名并标注 optional。

### 适配
- 适配 DSH 桌面端 v0.2.0-rc.2（`peerDependencies` 版本强校验）
- 模型调用使用 `ctx.llm` 服务，直接复用 DSH 已接入模型，无需额外配置 API Key
- 优化失败自动降级为本地规则，并在按钮旁提示降级原因

### 已知问题
- 通过 `link:`（Junction）安装时，宿主 HMR 不会追踪该插件的客户端产物，**改动 `dist/client/index.js` 后必须重启 DSH** 才能生效（普通目录安装的插件不受影响）。

## [0.1.0] - 2026-10-09

### 新增
- 双引擎优化架构：本地正则规则零成本优化 + LLM 深度语义优化
- 一键优化按钮注入 DSH 输入框工具栏，支持优化后一键撤销
- 角色化专项优化，内置 6 个高频专业角色（前端、后端、产品、数据分析、文案、通用）
- 自定义角色管理，支持角色增删改与专属优化提示
- 设置页面接入 DSH 系统设置面板，所有规则与参数可视化配置
- LLM 调用失败自动降级为本地规则优化，保证功能可用

### 适配
- 适配 DSH 桌面端 v0.2.0-rc.2（`peerDependencies` 版本强校验）
- 模型调用使用 `ctx.llm` 服务，直接复用 DSH 已接入模型，无需额外配置 API Key
