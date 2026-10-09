# DSH 提示词优化助手 插件开发文档

**文档版本**：v1.3.0  
**适配平台**：DeepSeek Harness (DSH) 桌面端 v0.2.0-rc.2  
**插件标识**：`prompt-optimizer`  
**开源协议**：MIT

---

## 一、插件概述

本插件为 DSH 输入框提供**一键提示词优化**能力，采用「本地规则引擎 + LLM 深度语义引擎」双架构设计：

- **本地规则引擎**：基于正则与字符串处理实现，零 Token 消耗、毫秒级响应，满足基础格式化、结构化与角色化需求；
- **LLM 深度引擎**：复用 DSH 原生已接入的大模型服务，支持用户自行指定模型，实现专业角色视角的语义级深度优化。

插件深度适配 DSH 原生插槽体系，按钮注入输入框工具栏，设置页接入系统设置面板，支持角色化专项优化，内置多个高频专业角色，也可完全自定义角色定位。

> 💡 **说明**：LLM 深度优化直接复用 DSH 中已配置的模型服务，无需额外接入 API、无需单独配置密钥，用户只需在设置中填写要使用的模型名称即可。

---

## 二、功能特性

### 核心能力

- ✅ **双引擎优化**：本地正则零成本优化 + LLM 深度语义优化，一键切换
- ✅ **角色化专项优化**：内置高频专业角色，优化自动贴合职业视角与术语体系
- ✅ **四级本地规则**：基础清洗、格式统一、结构化增强、角色注入，全开关可控
- ✅ **高度可配置**：所有规则独立开关，支持自定义角色、自定义约束条件
- ✅ **原生体验**：按钮与设置页原生注入，自动适配深色/浅色主题
- ✅ **一键撤销**：优化后快速恢复原始文本，操作无风险
- ✅ **自动降级**：LLM 调用失败自动切换本地规则，保证功能可用

### 内置高频专业角色

| 角色ID | 角色名称 | 优化偏向 | 适用场景 |
|--------|----------|----------|----------|
| `frontend-dev` | 前端开发工程师 | 补充组件化、技术栈约束、性能与兼容性要求 | 页面开发、组件封装、Bug修复、前端工程化 |
| `backend-dev` | 后端开发工程师 | 补充接口规范、数据结构、异常处理、安全校验 | 接口开发、数据库设计、服务端功能实现 |
| `product-manager` | 产品经理 | 补充用户场景、业务流程、验收标准、交互逻辑 | 需求文档、功能设计、产品逻辑梳理 |
| `data-analyst` | 数据分析师 | 明确指标口径、分析维度、筛选条件、输出格式 | 取数需求、SQL编写、分析报告、数据看板 |
| `copywriter` | 文案策划 | 明确受众定位、文风调性、核心卖点、传播目标 | 营销文案、品牌文案、内容创作、活动策划 |
| `general` | 通用角色 | 中立客观，纯优化表达，无专业偏向 | 通用提问、跨领域需求 |

---

## 三、整体架构

```
┌───────────────────────────────────────────────────────────┐
│                        客户端层                           │
│  ┌─────────────┐  ┌─────────────┐  ┌──────────────────┐  │
│  │ 优化按钮组件 │  │ 角色快速切换 │  │ 系统设置页面     │  │
│  └──────┬──────┘  └──────┬──────┘  └────────┬─────────┘  │
└─────────┼────────────────┼───────────────────┼────────────┘
          │                │                   │
┌─────────▼────────────────▼───────────────────▼────────────┐
│                        配置层                             │
│              ctx.config 持久化配置中心                     │
└─────────┬─────────────────────────────┬──────────────────┘
          │                             │
┌─────────▼─────────────┐     ┌─────────▼──────────────┐
│   本地规则引擎         │     │   LLM 深度引擎         │
│  正则+字符串处理       │     │  复用DSH原生模型服务    │
│  零延迟/零Token        │     │  用户自定模型参数       │
└───────────────────────┘     └────────────────────────┘
          │                             │
          └─────────────────┬───────────┘
                            ▼
                  输入框内容一键替换回填
```

### 核心分层职责

| 层级 | 职责 | 对应文件 |
|------|------|----------|
| 客户端层 | UI 插槽注入、交互逻辑、输入框读写 | `src/client/` |
| 服务层 | 优化核心逻辑、双引擎调度、模型调用 | `src/index.ts` |
| 配置层 | 参数 Schema 定义、默认值、持久化 | `src/config.ts` + `cordis.yml` |

---

## 四、项目目录结构

```
dsh-prompt-optimizer/
├── .github/
│   └── workflows/
│       └── build.yml          # 自动构建发布工作流
├── src/
│   ├── index.ts               # 插件主入口，服务注册
│   ├── config.ts              # 配置Schema与默认值
│   ├── local-optimizer.ts     # 本地规则引擎核心
│   └── client/
│       ├── index.tsx          # 客户端入口，插槽注入
│       ├── OptimizeButton.tsx # 优化按钮组件
│       └── SettingsPage.tsx   # 设置页面组件
├── cordis.yml                 # 插件元数据声明
├── package.json
├── tsconfig.json
├── icon.svg
├── .gitignore
├── LICENSE
├── README.md
└── CHANGELOG.md
```

---

## 五、核心配置与代码实现

### 5.1 package.json

```json
{
  "name": "prompt-optimizer",
  "version": "1.3.0",
  "description": "DSH 一键提示词优化插件，支持本地规则与角色化专项优化",
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "files": ["dist", "cordis.yml", "icon.svg"],
  "peerDependencies": {
    "@deepseek-ai/dsh": ">=0.2.0-rc.2 <0.3.0",
    "@deepseek-ai/dsh-client-slots": ">=0.2.0-rc.2 <0.3.0",
    "@deepseek-ai/dsh-client-composer": ">=0.2.0-rc.2 <0.3.0",
    "@deepseek-ai/dsh-client-llm": ">=0.2.0-rc.2 <0.3.0",
    "@deepseek-ai/dsh-client-settings": ">=0.2.0-rc.2 <0.3.0"
  },
  "devDependencies": {
    "typescript": "^5.4.0",
    "react": "^18.2.0"
  }
}
```

### 5.2 cordis.yml

```yaml
name: prompt-optimizer
displayName: 提示词优化助手
description: 输入框一键优化提示词，支持本地规则与角色化专项优化
version: 1.3.0
author: your-name
icon: ./icon.svg
client:
  entry: dist/client/index.js
  config:
    schema: ./dist/config.js
dependencies:
  - @deepseek-ai/dsh-client-slots
  - @deepseek-ai/dsh-client-composer
  - @deepseek-ai/dsh-client-llm
  - @deepseek-ai/dsh-client-settings
```

### 5.3 src/config.ts 配置定义

```typescript
export interface RoleItem {
  id: string
  name: string
  description: string
  rolePrompt: string
}

export interface LocalRulesConfig {
  cleanWhitespace: boolean
  filterPoliteWords: boolean
  normalizeList: boolean
  autoSplitParagraph: boolean
  splitSections: boolean
  appendConstraints: boolean
  constraintsText: string
  enableRoleOptimization: boolean
  currentRoleId: string
  customRoles: RoleItem[]
}

export interface PluginConfig {
  optimizeMode: 'local' | 'llm'
  llmModel: string
  llmTemperature: number
  localRules: LocalRulesConfig
}

// 内置高频专业角色
export const PRESET_ROLES: RoleItem[] = [
  {
    id: 'frontend-dev',
    name: '前端开发工程师',
    description: '侧重 React/Vue、TypeScript、UI还原、性能优化',
    rolePrompt: '你是资深前端开发工程师，熟悉 React、Vue、TypeScript、现代前端工程化。优化需求时请补充前端技术约束、浏览器兼容性、性能优化、代码规范等维度的隐含要求，输出工程化的开发指令。'
  },
  {
    id: 'backend-dev',
    name: '后端开发工程师',
    description: '侧重接口设计、数据库、性能、安全、架构',
    rolePrompt: '你是资深后端开发工程师，熟悉 Java/Go/Node、数据库设计、RESTful 接口、微服务架构。优化需求时请补充接口规范、数据结构、异常处理、安全校验、性能指标等技术约束。'
  },
  {
    id: 'product-manager',
    name: '产品经理',
    description: '侧重需求拆解、用户场景、验收标准、流程逻辑',
    rolePrompt: '你是互联网产品经理，擅长需求分析、用户场景拆解、功能逻辑设计。优化需求时请补充用户场景、业务流程、验收标准、异常分支、交互逻辑，输出清晰的产品需求文档结构。'
  },
  {
    id: 'data-analyst',
    name: '数据分析师',
    description: '侧重指标定义、数据口径、分析维度、输出格式',
    rolePrompt: '你是资深数据分析师，熟悉指标体系、SQL、数据口径、统计分析方法。优化需求时请明确指标定义、统计口径、分析维度、筛选条件、输出格式，输出可直接执行的分析指令。'
  },
  {
    id: 'copywriter',
    name: '文案策划',
    description: '侧重文风、受众定位、传播点、结构逻辑',
    rolePrompt: '你是资深文案策划，擅长品牌文案、营销文案、内容创作。优化需求时请明确受众定位、文风调性、传播目标、核心卖点，输出结构化的文案创作指令。'
  },
  {
    id: 'general',
    name: '通用角色',
    description: '通用优化，无专业偏向',
    rolePrompt: '你是通用提示词优化专家，保持中立客观，精准清晰表达需求。'
  }
]

export const defaultConfig: PluginConfig = {
  optimizeMode: 'local',
  llmModel: '', // 用户自行填写模型名称
  llmTemperature: 0.2,
  localRules: {
    cleanWhitespace: true,
    filterPoliteWords: true,
    normalizeList: true,
    autoSplitParagraph: false,
    splitSections: true,
    appendConstraints: false,
    constraintsText: '使用 TypeScript 编写，代码带注释，错误处理完善',
    enableRoleOptimization: false,
    currentRoleId: 'general',
    customRoles: []
  }
}
```

### 5.4 src/local-optimizer.ts 本地规则引擎

```typescript
import type { LocalRulesConfig, RoleItem } from './config'

/**
 * 本地正则优化引擎 - 零Token消耗
 * @param text 原始输入文本
 * @param config 规则配置
 * @param currentRole 当前生效角色
 */
export function localOptimize(
  text: string,
  config: LocalRulesConfig,
  currentRole: RoleItem
): string {
  let result = text.trim()
  if (!result) return ''

  // L1 基础清洗
  if (config.cleanWhitespace) {
    result = result.replace(/\n{3,}/g, '\n\n')
    result = result.replace(/^[ \t]+|[ \t]+$/gm, '')
    result = result.replace(/ {2,}/g, ' ')
  }

  if (config.filterPoliteWords) {
    const politePattern = /^(麻烦|帮我|请问|我想|能不能|麻烦你|请你|谢谢|感谢|拜托|您好|你好)[，。：:\s]*/gim
    result = result.replace(politePattern, '')
    result = result.replace(/[，。\s]*(谢谢|感谢|拜托了|辛苦了)[。！\s]*$/gim, '')
  }

  // L2 格式规范化
  if (config.normalizeList) {
    result = result.replace(/^[（(【\[]?(\d+)[）)】\]、\.\s]+/gm, '$1. ')
    result = result.replace(/^[—\-*●▪◆•▪]\s+/gm, '- ')
  }

  if (config.autoSplitParagraph) {
    result = result.replace(/([。；;])/g, '$1\n')
    result = result.replace(/\n{3,}/g, '\n\n')
  }

  // L3 结构化增强
  if (config.splitSections) {
    const sectionKeywords = ['需求', '功能', '要求', '问题', '背景', '约束', '交付', '注意']
    sectionKeywords.forEach(keyword => {
      const reg = new RegExp(`^${keyword}[：:]\\s*`, 'gim')
      result = result.replace(reg, `\n### ${keyword}：\n`)
    })
    result = result.trimStart()
  }

  if (config.appendConstraints && config.constraintsText.trim()) {
    result = result.trimEnd() + '\n\n' + config.constraintsText.trim()
  }

  // L4 角色化注入
  if (config.enableRoleOptimization && currentRole) {
    result = `角色：${currentRole.name}\n` + result
  }

  return result.trim()
}
```

### 5.5 src/index.ts 插件主入口

```typescript
import { Plugin } from 'cordis'
import { localOptimize } from './local-optimizer'
import type { PluginConfig, RoleItem } from './config'
import { defaultConfig, PRESET_ROLES } from './config'

// 基础优化方法论模板
const BASE_OPTIMIZE_TEMPLATE = `请严格按照以下4个步骤优化用户输入，直接输出优化后的最终内容，不要输出解释、不要输出思考过程。
优化步骤：
1. 【核心诉求提炼】用一句话明确最终目标，去掉所有口语、寒暄、铺垫。
2. 【结构化拆解】将需求拆分为多个要点，用编号列表清晰呈现。
3. 【歧义消除与补全】识别模糊表述，补充合理的默认上下文，明确边界条件。
4. 【指令规范化】整理为标准清晰的指令格式，输出可直接执行的内容。
注意：禁止改变用户原始需求，只优化表达形式和清晰度。`

export default class PromptOptimizerPlugin extends Plugin {
  constructor(ctx: any) {
    super(ctx)
    ctx.config.defaults(defaultConfig)
  }

  apply() {
    this.ctx.service('promptOptimizer', {
      /** 统一优化入口 */
      async optimize(content: string): Promise<string> {
        const config = this.ctx.config.get<PluginConfig>()
        const currentRole = this.getCurrentRole()

        if (config.optimizeMode === 'local' || !config.llmModel.trim()) {
          return localOptimize(content, config.localRules, currentRole)
        } else {
          return this.llmOptimize(content, currentRole)
        }
      },

      /** 获取当前生效角色 */
      getCurrentRole(): RoleItem {
        const config = this.ctx.config.get<PluginConfig>()
        const allRoles = [...PRESET_ROLES, ...config.localRules.customRoles]
        return allRoles.find(r => r.id === config.localRules.currentRoleId) || PRESET_ROLES[5]
      },

      /** 获取所有可用角色 */
      getAllRoles(): RoleItem[] {
        const config = this.ctx.config.get<PluginConfig>()
        return [...PRESET_ROLES, ...config.localRules.customRoles]
      },

      /** LLM深度优化 - 复用DSH已接入模型 */
      async llmOptimize(content: string, currentRole: RoleItem): Promise<string> {
        const config = this.ctx.config.get<PluginConfig>()
        const cleanedContent = content.trim().replace(/\n{3,}/g, '\n\n')

        if (!cleanedContent) return ''
        if (cleanedContent.length < 10) return cleanedContent

        // 拼接角色提示 + 基础优化模板
        const systemPrompt = config.localRules.enableRoleOptimization
          ? `${currentRole.rolePrompt}\n\n${BASE_OPTIMIZE_TEMPLATE}`
          : BASE_OPTIMIZE_TEMPLATE

        try {
          const response = await this.ctx.llm.chat({
            messages: [
              { role: 'system', content: systemPrompt },
              { role: 'user', content: `待优化内容：\n${cleanedContent}` }
            ],
            temperature: config.llmTemperature,
            model: config.llmModel
          })

          let result = response.content.trim()
          result = result.replace(/^```\w*\n?/, '').replace(/```$/, '')
          return result.trim()
        } catch (error) {
          console.error('[提示词优化] LLM调用失败，降级为本地优化', error)
          return localOptimize(content, config.localRules, currentRole)
        }
      },

      localOptimize(content: string): string {
        const config = this.ctx.config.get<PluginConfig>()
        return localOptimize(content, config.localRules, this.getCurrentRole())
      }
    })
  }
}
```

### 5.6 客户端入口 src/client/index.tsx

```tsx
import { Plugin } from 'cordis'
import { OptimizeButton } from './OptimizeButton'
import { SettingsPage } from './SettingsPage'

export default class PromptOptimizerClient extends Plugin {
  apply() {
    // 注入输入框工具栏按钮（模型选择器左侧）
    this.ctx.slots.inject('composer.toolbar.model.before', () => (
      <OptimizeButton />
    ))

    // 注入系统设置页面
    this.ctx.slots.inject('settings.sections', () => ({
      id: 'prompt-optimizer',
      title: '提示词优化助手',
      icon: '✨',
      component: <SettingsPage />
    }))
  }
}
```

### 5.7 优化按钮组件 src/client/OptimizeButton.tsx

```tsx
import React, { useState, useRef } from 'react'
import { useService } from '@deepseek-ai/dsh-client-runtime'
import { useComposer } from '@deepseek-ai/dsh-client-composer'

export const OptimizeButton = () => {
  const [loading, setLoading] = useState(false)
  const promptOptimizer = useService('promptOptimizer')
  const { value, setValue } = useComposer()
  const lastValueRef = useRef<string>('')

  const handleOptimize = async () => {
    if (!value.trim() || loading) return
    setLoading(true)
    lastValueRef.current = value
    try {
      const optimized = await promptOptimizer.optimize(value)
      setValue(optimized)
    } catch (e) {
      console.error('优化失败', e)
    } finally {
      setLoading(false)
    }
  }

  const handleUndo = () => {
    if (lastValueRef.current) setValue(lastValueRef.current)
  }

  return (
    <div style={{ display: 'flex', alignItems: 'center', marginRight: 8, gap: 4 }}>
      <button
        className="dsw-button dsw-button-ghost dsw-button-sm"
        onClick={handleOptimize}
        disabled={loading || !value.trim()}
        title="一键优化当前提示词"
      >
        {loading ? '优化中...' : '✨ 优化提示词'}
      </button>

      {lastValueRef.current && lastValueRef.current !== value && (
        <button
          className="dsw-button dsw-button-ghost dsw-button-sm"
          onClick={handleUndo}
          title="撤销优化，恢复原文"
        >
          ↩ 撤销
        </button>
      )}
    </div>
  )
}
```

### 5.8 设置页面组件 src/client/SettingsPage.tsx

```tsx
import React, { useState } from 'react'
import { useConfig } from '@deepseek-ai/dsh-client-settings'
import { Form, Switch, Select, Input, TextArea, Card, Button, Modal, List } from '@deepseek-ai/dsh-client-ui'
import type { RoleItem } from '../config'

export const SettingsPage = () => {
  const [config, setConfig] = useConfig()
  const [roleModalVisible, setRoleModalVisible] = useState(false)
  const [editingRole, setEditingRole] = useState<RoleItem | null>(null)
  const [formData, setFormData] = useState({ name: '', description: '', rolePrompt: '' })

  const allRoles = React.useMemo(() => {
    const presetNames = [
      { id: 'frontend-dev', name: '前端开发工程师' },
      { id: 'backend-dev', name: '后端开发工程师' },
      { id: 'product-manager', name: '产品经理' },
      { id: 'data-analyst', name: '数据分析师' },
      { id: 'copywriter', name: '文案策划' },
      { id: 'general', name: '通用角色' }
    ]
    return [...presetNames, ...config.localRules.customRoles]
  }, [config.localRules.customRoles])

  const openRoleModal = (role?: RoleItem) => {
    if (role) {
      setEditingRole(role)
      setFormData({ name: role.name, description: role.description, rolePrompt: role.rolePrompt })
    } else {
      setEditingRole(null)
      setFormData({ name: '', description: '', rolePrompt: '' })
    }
    setRoleModalVisible(true)
  }

  const saveRole = () => {
    if (!formData.name.trim()) return
    if (editingRole) {
      const updated = config.localRules.customRoles.map(r =>
        r.id === editingRole.id ? { ...r, ...formData } : r
      )
      setConfig('localRules.customRoles', updated)
    } else {
      const newRole: RoleItem = { id: 'custom-' + Date.now(), ...formData }
      setConfig('localRules.customRoles', [...config.localRules.customRoles, newRole])
    }
    setRoleModalVisible(false)
  }

  const deleteRole = (id: string) => {
    const filtered = config.localRules.customRoles.filter(r => r.id !== id)
    setConfig('localRules.customRoles', filtered)
    if (config.localRules.currentRoleId === id) {
      setConfig('localRules.currentRoleId', 'general')
    }
  }

  return (
    <div style={{ padding: 16, maxWidth: 640 }}>
      <Card title="基础设置">
        <Form layout="vertical">
          <Form.Item label="优化模式">
            <Select
              value={config.optimizeMode}
              onChange={(v) => setConfig('optimizeMode', v)}
              options={[
                { value: 'local', label: '本地规则优化（零成本）' },
                { value: 'llm', label: 'LLM 深度优化（消耗Token）' }
              ]}
            />
          </Form.Item>

          {config.optimizeMode === 'llm' && (
            <>
              <Form.Item label="模型名称" required>
                <Input
                  value={config.llmModel}
                  onChange={(e) => setConfig('llmModel', e.target.value)}
                  placeholder="填写DSH中已接入的模型名称，如 deepseek-flash"
                />
                <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 4 }}>
                  请确保该模型已在 DSH 中配置可用，插件直接复用 DSH 的模型服务
                </div>
              </Form.Item>

              <Form.Item label="模型温度 (0-1)">
                <Input
                  type="number"
                  min={0}
                  max={1}
                  step={0.1}
                  value={config.llmTemperature}
                  onChange={(e) => setConfig('llmTemperature', Number(e.target.value))}
                />
              </Form.Item>
            </>
          )}
        </Form>
      </Card>

      <Card title="角色专项优化" style={{ marginTop: 16 }}>
        <Form layout="vertical">
          <Form.Item>
            <Switch
              checked={config.localRules.enableRoleOptimization}
              onChange={(v) => setConfig('localRules.enableRoleOptimization', v)}
              label="开启角色专项优化"
            />
            <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 4 }}>
              开启后，优化将贴合所选专业角色的视角与术语体系，输出更具针对性的提示词
            </div>
          </Form.Item>

          {config.localRules.enableRoleOptimization && (
            <>
              <Form.Item label="选择角色">
                <Select
                  value={config.localRules.currentRoleId}
                  onChange={(v) => setConfig('localRules.currentRoleId', v)}
                  options={allRoles.map(r => ({ value: r.id, label: r.name }))}
                />
              </Form.Item>

              <Form.Item label="自定义角色">
                <Button type="primary" size="sm" onClick={() => openRoleModal()}>
                  + 添加自定义角色
                </Button>

                {config.localRules.customRoles.length > 0 && (
                  <List style={{ marginTop: 8 }}>
                    {config.localRules.customRoles.map(role => (
                      <List.Item
                        key={role.id}
                        actions={[
                          <Button size="xs" onClick={() => openRoleModal(role)}>编辑</Button>,
                          <Button size="xs" danger onClick={() => deleteRole(role.id)}>删除</Button>
                        ]}
                      >
                        <div>
                          <div style={{ fontWeight: 500 }}>{role.name}</div>
                          <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                            {role.description}
                          </div>
                        </div>
                      </List.Item>
                    ))}
                  </List>
                )}
              </Form.Item>
            </>
          )}
        </Form>
      </Card>

      <Card title="本地优化规则" style={{ marginTop: 16 }}>
        <Form layout="vertical">
          <Form.Item>
            <Switch
              checked={config.localRules.cleanWhitespace}
              onChange={(v) => setConfig('localRules.cleanWhitespace', v)}
              label="自动清理空白字符与空行"
            />
          </Form.Item>
          <Form.Item>
            <Switch
              checked={config.localRules.filterPoliteWords}
              onChange={(v) => setConfig('localRules.filterPoliteWords', v)}
              label="过滤客套语气词"
            />
          </Form.Item>
          <Form.Item>
            <Switch
              checked={config.localRules.normalizeList}
              onChange={(v) => setConfig('localRules.normalizeList', v)}
              label="统一列表序号格式"
            />
          </Form.Item>
          <Form.Item>
            <Switch
              checked={config.localRules.splitSections}
              onChange={(v) => setConfig('localRules.splitSections', v)}
              label="自动识别并拆分语义区块"
            />
          </Form.Item>
          <Form.Item>
            <Switch
              checked={config.localRules.autoSplitParagraph}
              onChange={(v) => setConfig('localRules.autoSplitParagraph', v)}
              label="长文本自动分段"
            />
          </Form.Item>
          <Form.Item>
            <Switch
              checked={config.localRules.appendConstraints}
              onChange={(v) => setConfig('localRules.appendConstraints', v)}
              label="自动补充约束条件"
            />
            {config.localRules.appendConstraints && (
              <TextArea
                rows={2}
                value={config.localRules.constraintsText}
                onChange={(e) => setConfig('localRules.constraintsText', e.target.value)}
                placeholder="例如：使用 TypeScript，代码带注释"
                style={{ marginTop: 8 }}
              />
            )}
          </Form.Item>
        </Form>
      </Card>

      <Modal
        title={editingRole ? '编辑角色' : '添加自定义角色'}
        visible={roleModalVisible}
        onOk={saveRole}
        onCancel={() => setRoleModalVisible(false)}
      >
        <Form layout="vertical">
          <Form.Item label="角色名称" required>
            <Input
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              placeholder="例如：测试工程师"
            />
          </Form.Item>
          <Form.Item label="角色描述">
            <Input
              value={formData.description}
              onChange={(e) => setFormData({ ...formData, description: e.target.value })}
              placeholder="一句话描述角色定位"
            />
          </Form.Item>
          <Form.Item label="角色优化提示" required>
            <TextArea
              rows={4}
              value={formData.rolePrompt}
              onChange={(e) => setFormData({ ...formData, rolePrompt: e.target.value })}
              placeholder="描述该角色的专业背景、优化偏向、关注维度"
            />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  )
}
```

---

## 六、安装与使用

### 6.1 环境要求

- DeepSeek Harness 桌面端 = v0.2.0-rc.2
- Node.js ≥ 18.0.0

### 6.2 安装步骤

1. **构建插件**

   ```bash
   npm install
   npm run build
   ```

2. **安装到DSH**

   ```bash
   dsh plugin add ./dsh-prompt-optimizer
   ```

3. **验证安装**

   重启 DSH 后，输入框工具栏模型选择器左侧出现「✨ 优化提示词」按钮即为安装成功。

### 6.3 使用方法

1. 在输入框中输入原始提示词
2. 点击「✨ 优化提示词」按钮，一键完成优化
3. 优化后点击「↩ 撤销」可恢复原始文本
4. 打开「设置 → 提示词优化助手」可配置：
   - 切换本地/LLM优化模式
   - 开启角色专项优化并选择角色
   - 调整本地优化规则开关
   - 添加/编辑自定义角色

### 6.4 LLM 模式使用前置条件

1. 确保 DSH 中已接入并配置好可用的大模型
2. 在插件设置中填写对应的模型名称（与 DSH 模型列表中的名称一致）
3. 切换优化模式为「LLM 深度优化」即可

---

## 七、更新日志

```markdown
## [1.3.0] - 2026-10-09

### 新增
- 新增角色化专项优化能力，内置6个高频专业角色
- 新增自定义角色管理，支持角色增删改与专属优化提示
- 角色优化同时适配本地规则引擎与LLM深度引擎
- 设置页面新增角色配置区块，支持开关、选择、自定义管理

### 调整
- LLM模型改为用户自行配置，不内置默认模型，复用DSH已接入服务
- 重构优化系统提示拼接逻辑，角色与基础优化方法论解耦

### 修复
- 修复空内容调用优化时报错的问题
- 修复LLM调用失败降级逻辑异常
```

---

## 八、开源发布说明

本插件推荐托管至 GitHub，遵循语义化版本管理，使用 GitHub Actions 自动构建发布。

### 仓库推荐配置

- 仓库名：`dsh-prompt-optimizer`
- 分支策略：`main` 稳定分支 + `dev` 开发分支
- Issue 分类：`bug`、`feature`、`compatibility`、`question`

### 自动构建工作流示例

`.github/workflows/build.yml` 配置提交代码自动校验、打 Tag 自动发布 Release 包，完整配置可参考 DSH 插件官方最佳实践。

---

> 本文档可直接保存为 `README.md` 或 `plugin-doc.md` 使用，所有代码片段可直接复制用于插件开发。
