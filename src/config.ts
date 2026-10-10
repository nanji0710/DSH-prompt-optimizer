/**
 * 插件配置 Schema、默认值与内置专业角色
 */

export interface RoleItem {
  /** 角色唯一ID */
  id: string
  /** 角色名称 */
  name: string
  /** 角色描述 */
  description: string
  /** 角色专属优化提示，注入到优化系统提示词中 */
  rolePrompt: string
}

export interface LocalRulesConfig {
  /** L1 清理首尾空格、合并连续空行 */
  cleanWhitespace: boolean
  /** L1 过滤客套语气词 */
  filterPoliteWords: boolean
  /** L2 统一列表序号格式 */
  normalizeList: boolean
  /** L2 长文本按句号自动分段 */
  autoSplitParagraph: boolean
  /** L3 识别关键词并拆分语义区块 */
  splitSections: boolean
  /** L3 末尾追加约束条件 */
  appendConstraints: boolean
  /** 自定义约束条件文本 */
  constraintsText: string
  /** 是否开启角色专项优化 */
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
  /** 模型采样温度 0-1 */
  llmTemperature: number
  /** 本地规则配置 */
  localRules: LocalRulesConfig
}

/** 内置高频专业角色 */
export const PRESET_ROLES: RoleItem[] = [
  {
    id: 'frontend-dev',
    name: '前端开发工程师',
    description: '侧重 React/Vue、TypeScript、UI还原、性能优化',
    rolePrompt:
      '你是资深前端开发工程师，熟悉 React、Vue、TypeScript、现代前端工程化。优化需求时请补充前端技术约束、浏览器兼容性、性能优化、代码规范等维度的隐含要求，输出工程化的开发指令。'
  },
  {
    id: 'backend-dev',
    name: '后端开发工程师',
    description: '侧重接口设计、数据库、性能、安全、架构',
    rolePrompt:
      '你是资深后端开发工程师，熟悉 Java/Go/Node、数据库设计、RESTful 接口、微服务架构。优化需求时请补充接口规范、数据结构、异常处理、安全校验、性能指标等技术约束。'
  },
  {
    id: 'product-manager',
    name: '产品经理',
    description: '侧重需求拆解、用户场景、验收标准、流程逻辑',
    rolePrompt:
      '你是互联网产品经理，擅长需求分析、用户场景拆解、功能逻辑设计。优化需求时请补充用户场景、业务流程、验收标准、异常分支、交互逻辑，输出清晰的产品需求文档结构。'
  },
  {
    id: 'data-analyst',
    name: '数据分析师',
    description: '侧重指标定义、数据口径、分析维度、输出格式',
    rolePrompt:
      '你是资深数据分析师，熟悉指标体系、SQL、数据口径、统计分析方法。优化需求时请明确指标定义、统计口径、分析维度、筛选条件、输出格式，输出可直接执行的分析指令。'
  },
  {
    id: 'copywriter',
    name: '文案策划',
    description: '侧重文风、受众定位、传播点、结构逻辑',
    rolePrompt:
      '你是资深文案策划，擅长品牌文案、营销文案、内容创作。优化需求时请明确受众定位、文风调性、传播目标、核心卖点，输出结构化的文案创作指令。'
  },
  {
    id: 'general',
    name: '通用角色',
    description: '通用优化，无专业偏向',
    rolePrompt: '你是通用提示词优化专家，保持中立客观，精准清晰表达需求。'
  }
]

/** 默认配置 */
export const defaultConfig: PluginConfig = {
  // 默认走 LLM 真改写；调用失败会自动降级为本地规则
  optimizeMode: 'llm',
  llmProvider: '',
  llmModel: '',
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
