# DSH 提示词优化助手

> 一键优化输入框提示词，支持本地规则零成本优化 + 角色化 LLM 深度语义优化双模式

![dsh-version](https://img.shields.io/badge/DSH-v0.2.0--rc.2-blue)
![license](https://img.shields.io/badge/license-MIT-green)
![version](https://img.shields.io/badge/version-0.1.0-orange)

## ✨ 功能特性

- 🚀 **双引擎优化**：本地正则规则零成本毫秒级优化 + LLM 大模型深度语义优化
- 🎭 **角色化专项优化**：内置前端、后端、产品、数据分析、文案、通用 6 个高频专业角色，并支持完全自定义角色
- ⚙️ **高度可配置**：所有本地规则独立开关，支持自定义角色前缀、约束条件
- 🔄 **自动降级**：LLM 调用失败自动切换本地规则，保证功能可用
- 🎨 **原生整合**：深度适配 DSH 桌面端 v0.2.0-rc.2，按钮与设置页原生注入，自动适配深色/浅色主题
- ↩️ **一键撤销**：优化后可快速恢复原始文本，操作无风险

## 📦 兼容版本

- ✅ DeepSeek Harness 桌面端 `v0.2.0-rc.2`
- ⚠️ 不兼容 v0.1.x 版本

## 🚀 快速安装

### 方式一：在线安装（推荐）

```bash
dsh plugin add https://github.com/nanji0710/DSH-prompt-optimizer
```

### 方式二：手动安装

1. 前往 [Releases](https://github.com/nanji0710/DSH-prompt-optimizer/releases) 下载最新版本 `prompt-optimizer-v0.1.0.zip`
2. 解压到本地目录
3. 在 DSH 中执行：

```bash
dsh plugin add ./解压后的目录路径
```

## 📖 使用方法

1. 在 DSH 输入框中输入原始提示词
2. 点击输入框工具栏模型选择器左侧的「✨ 优化提示词」按钮，一键完成优化
3. 优化后点击「↩ 撤销」可恢复原始文本
4. 打开 `设置 → 提示词优化助手`，可切换优化模式、选择专业角色、调整本地规则、管理自定义角色

## ⚙️ 配置说明

### 基础设置

| 配置项 | 默认值 | 说明 |
|--------|--------|------|
| 优化模式 | 本地规则优化 | 本地规则（零成本）/ LLM 深度优化（消耗 Token） |
| 模型名称 | 空（需自行填写） | LLM 模式下使用的模型名称，须与 DSH 中已接入的模型一致 |
| 模型温度 | 0.2 | 0-1，值越低优化结果越稳定 |

> 💡 LLM 深度优化直接复用 DSH 中已配置的模型服务，**无需额外接入 API、无需单独配置密钥**，只需填写模型名称。

### 角色专项优化

| 内置角色 | 优化偏向 |
|----------|----------|
| 前端开发工程师 | 组件化、技术栈约束、性能与兼容性 |
| 后端开发工程师 | 接口规范、数据结构、异常处理、安全校验 |
| 产品经理 | 用户场景、业务流程、验收标准、交互逻辑 |
| 数据分析师 | 指标口径、分析维度、筛选条件、输出格式 |
| 文案策划 | 受众定位、文风调性、核心卖点、传播目标 |
| 通用角色 | 中立客观，纯优化表达 |

支持添加任意自定义角色（名称 + 描述 + 角色优化提示）。

### 本地优化规则

- 自动清理空白字符与空行
- 过滤客套语气词
- 统一列表序号格式
- 自动识别并拆分语义区块
- 长文本自动分段（可选）
- 自动补充约束条件（可选，文本可自定义）

## 🔄 更新插件

```bash
dsh plugin update prompt-optimizer
```

## 🛠️ 本地开发

### 环境要求

- Node.js ≥ 18
- DSH 桌面端 v0.2.0-rc.2

### 构建

```bash
npm install
npm run build
```

构建产物输出至 `dist/`：

- `dist/index.js`：插件服务端（tsc 编译）
- `dist/config.js`：配置 Schema 与默认值
- `dist/local-optimizer.js`：本地规则引擎
- `dist/client/index.js`：客户端打包产物（esbuild 单文件）

### 目录结构

```
src/
├── index.ts               # 插件主入口，服务注册
├── config.ts              # 配置 Schema、默认值、内置角色
├── local-optimizer.ts     # 本地正则规则引擎
├── types/external.d.ts    # DSH 宿主模块类型声明
└── client/
    ├── index.tsx          # 客户端入口，插槽注入
    ├── OptimizeButton.tsx # 优化按钮组件
    └── SettingsPage.tsx   # 设置页面组件
```

> 说明：`@deepseek-ai/dsh-*`、`cordis`、`react` 由 DSH 宿主运行时提供，本地构建通过 `.npmrc` 的 `legacy-peer-deps=true` 跳过安装，打包时标记为 external。

## 📝 更新日志

详见 [CHANGELOG.md](./CHANGELOG.md)

## 🤝 贡献指南

欢迎提交 Issue 和 PR：

1. Fork 本仓库
2. 创建功能分支：`git checkout -b feature/xxx`
3. 提交修改：`git commit -m 'feat: add xxx'`
4. 推送分支：`git push origin feature/xxx`
5. 提交 Pull Request

## 📄 许可证

[MIT License](./LICENSE)
