/**
 * 插件配置 Schema、默认值与内置专业角色
 *
 * ★ v0.3.0 重设计（依据 docs/optimization-directions.md）：
 * 本地规则从「四层清洗/结构/约束/角色」改为**两级**流水线
 * 「信息抽取 → 紧凑重组」，并砍掉旧版的 L0 客套清除与 L2 通用约束补全
 * 两个开关组（实测对短诉求没有增量，只增加篇幅）。
 *
 * 角色提示词同步压缩为**一行**：旧版每个角色都是多句长模板，注入后
 * 与「动作导向」原则冲突（输出以"我是谁"开头而不是"你要做什么"）。
 */

export interface RoleItem {
  /** 角色唯一ID */
  id: string
  /** 角色名称 */
  name: string
  /** 角色描述 */
  description: string
  /**
   * 角色提示词。★ 只写**一行**，且必须能改变模型的输出行为
   * （例如"先给结论再给依据"）；写"你是资深 XX 工程师"这类无法改变
   * 行为的话术对回答质量没有增量，只会占篇幅。
   */
  rolePrompt: string
}

/**
 * 本地规则配置（v0.3.0 两级流水线）。
 *
 * 流水线：`原文 → Step 1 信息抽取（实体/指标/动作/场景）→ Step 2 紧凑重组`
 * 重组只会套用**一个**最匹配的场景模板，不是五段式填充。
 */
export interface LocalRulesConfig {
  /** Step 1：抽取平台、指标、数据表、技术栈等实体，用于紧凑重组 */
  extractEntities: boolean
  /** Step 1：识别动作并改写为动词开头的可执行指令 */
  actionOriented: boolean
  /** Step 2：按场景套用紧凑模板（数据对账 / 代码开发 / 文档写作 / 问答） */
  applyTemplate: boolean
  /** 是否注入角色（默认关；开启后只作为首行写 1 句） */
  enableRoleOptimization: boolean
  /** 当前选中的角色ID */
  currentRoleId: string
  /** 用户自定义角色列表 */
  customRoles: RoleItem[]
}

export interface PluginConfig {
  /** 优化模式：local 本地规则 / llm 大模型深度优化 */
  optimizeMode: 'local' | 'llm'
  /** LLM 模式使用的 provider 路由（如 deepseek-official / workbuddy；留空则用 DSH 默认模型） */
  llmProvider: string
  /** LLM 模式使用的模型名称（留空则用 DSH 默认模型） */
  llmModel: string
  /**
   * 思考强度档位（如 off / low / medium / high / max）。
   *
   * 必须是所选模型 `reasoning.efforts` 里的 id —— 不支持的档位宿主会在发起
   * 请求前直接抛 `UNSUPPORTED_REASONING_EFFORT`，部分上游还会回
   * 400「模型不支持该思考强度，请调整」。
   *
   * 空串 = 交给插件自动选：取模型声明的 `defaultEffort`，没有则取它支持的最轻
   * 一档（**不会用 `off`**，因为 `off` 在不少上游的 wire 映射里是不被接受的）。
   */
  llmReasoningEffort: string
  /** 模型采样温度 0-1 */
  llmTemperature: number
  /** 本地规则配置 */
  localRules: LocalRulesConfig
}

/**
 * 内置专业角色（rolePrompt 全部为一行）。
 *
 * `general` 的 rolePrompt 为空串：选它等于**不注入任何角色行**，
 * 与「默认不注入角色」的原则一致。
 */
export const PRESET_ROLES: RoleItem[] = [
  {
    id: 'frontend-dev',
    name: '前端开发工程师',
    description: '侧重 React/Vue、UI 还原、性能',
    rolePrompt: '你是一名前端工程师，回答时先给可运行的代码再解释关键逻辑。'
  },
  {
    id: 'backend-dev',
    name: '后端开发工程师',
    description: '侧重接口设计、数据库、异常处理',
    rolePrompt: '你是一名后端工程师，回答时先给接口与数据结构设计再给实现。'
  },
  {
    id: 'product-manager',
    name: '产品经理',
    description: '侧重用户场景、流程、验收标准',
    rolePrompt: '你是一名产品经理，回答时先给用户场景与验收标准再展开方案。'
  },
  {
    id: 'data-analyst',
    name: '数据分析师',
    description: '侧重指标口径、SQL、分析结论',
    rolePrompt: '你是一名数据分析师，回答时先给结论再给依据。'
  },
  {
    id: 'copywriter',
    name: '文案策划',
    description: '侧重文风、受众、传播点',
    rolePrompt: '你是一名文案策划，回答时先给成稿再给可替换的备选表达。'
  },
  {
    id: 'general',
    name: '通用角色',
    description: '不注入角色行（默认）',
    rolePrompt: ''
  }
]

/** 默认配置 */
export const defaultConfig: PluginConfig = {
  // 默认走 LLM 真改写（更克制、零占位符）；调用失败自动降级为本地规则
  optimizeMode: 'llm',
  llmProvider: '',
  llmModel: '',
  // 空 = 按所选模型的能力自动挑一档；见 PluginConfig.llmReasoningEffort
  llmReasoningEffort: '',
  llmTemperature: 0.2,
  localRules: {
    extractEntities: true,
    actionOriented: true,
    applyTemplate: true,
    enableRoleOptimization: false,
    currentRoleId: 'general',
    customRoles: []
  }
}
