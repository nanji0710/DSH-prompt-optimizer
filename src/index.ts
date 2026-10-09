/**
 * 提示词优化助手 - 插件服务端入口
 * 注册 promptOptimizer 服务，统一调度本地规则引擎与 LLM 深度引擎。
 *
 * 导出契约：命名导出 name / apply（DSH Cordis loader 要求），同时默认导出 apply 以兼容。
 */
import { localOptimize } from './local-optimizer'
import { defaultConfig, PRESET_ROLES } from './config'
import type { PluginConfig, RoleItem } from './config'

/** 插件显示名（仅用于诊断） */
export const name = 'prompt-optimizer'

/** 基础优化方法论模板（四步标准化优化） */
const BASE_OPTIMIZE_TEMPLATE = `请严格按照以下4个步骤优化用户输入，直接输出优化后的最终内容，不要输出解释、不要输出思考过程。
优化步骤：
1. 【核心诉求提炼】用一句话明确最终目标，去掉所有口语、寒暄、铺垫。
2. 【结构化拆解】将需求拆分为多个要点，用编号列表清晰呈现。
3. 【歧义消除与补全】识别模糊表述，补充合理的默认上下文，明确边界条件。
4. 【指令规范化】整理为标准清晰的指令格式，输出可直接执行的内容。
注意：禁止改变用户原始需求，只优化表达形式和清晰度。`

/** 插件主体：注册 promptOptimizer 服务 */
export function apply(ctx: any) {
  // 注入默认配置（兼容不同版本 config API）
  if (ctx.config?.defaults) {
    ctx.config.defaults(defaultConfig)
  }

  /** 读取当前配置，与默认值做浅合并以防御缺字段 */
  const getConfig = (): PluginConfig => {
    const cfg = ctx.config.get ? ctx.config.get() : undefined
    return {
      ...defaultConfig,
      ...cfg,
      localRules: { ...defaultConfig.localRules, ...(cfg?.localRules || {}) }
    }
  }

  /** 获取当前生效角色（内置 + 自定义合并查找） */
  const getCurrentRole = (): RoleItem => {
    const config = getConfig()
    const allRoles = [...PRESET_ROLES, ...config.localRules.customRoles]
    return (
      allRoles.find((r) => r.id === config.localRules.currentRoleId) ||
      PRESET_ROLES[PRESET_ROLES.length - 1]
    )
  }

  /** 获取所有可用角色 */
  const getAllRoles = (): RoleItem[] => {
    const config = getConfig()
    return [...PRESET_ROLES, ...config.localRules.customRoles]
  }

  /** 去除模型输出中可能的代码块包裹 */
  const stripCodeFence = (input: string): string => {
    let result = input.trim()
    if (/^```[a-zA-Z]*\n[\s\S]*```$/.test(result)) {
      result = result.replace(/^```[a-zA-Z]*\n?/, '').replace(/```$/, '')
    }
    return result.trim()
  }

  /** LLM 深度优化：复用 DSH 已接入的模型服务（可选依赖，用 ctx.get 探测） */
  const llmOptimize = async (content: string, currentRole: RoleItem): Promise<string> => {
    const config = getConfig()
    const cleanedContent = content.trim().replace(/\n{3,}/g, '\n\n')
    if (!cleanedContent) return ''
    if (cleanedContent.length < 10) return cleanedContent

    const systemPrompt = config.localRules.enableRoleOptimization
      ? `${currentRole.rolePrompt}\n\n${BASE_OPTIMIZE_TEMPLATE}`
      : BASE_OPTIMIZE_TEMPLATE

    // 优先使用注入的 ctx.llm；未注入时用 ctx.get('llm') 探测可选服务
    const llm = ctx.llm || ctx.get?.('llm')
    if (!llm?.chat) {
      return localOptimize(content, config.localRules, currentRole)
    }

    try {
      const response = await llm.chat({
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: `待优化内容：\n${cleanedContent}` }
        ],
        temperature: config.llmTemperature,
        model: config.llmModel
      })
      return stripCodeFence(response?.content || cleanedContent)
    } catch (error) {
      console.error('[提示词优化] LLM 调用失败，降级为本地优化：', error)
      return localOptimize(content, config.localRules, currentRole)
    }
  }

  /** 本地规则优化 */
  const runLocalOptimize = (content: string): string => {
    const config = getConfig()
    return localOptimize(content, config.localRules, getCurrentRole())
  }

  /** 统一优化入口：按配置自动选择引擎；未配置模型时强制走本地引擎 */
  const optimize = async (content: string): Promise<string> => {
    const config = getConfig()
    const currentRole = getCurrentRole()
    if (config.optimizeMode === 'llm' && config.llmModel.trim()) {
      return llmOptimize(content, currentRole)
    }
    return localOptimize(content, config.localRules, currentRole)
  }

  ctx.service('promptOptimizer', {
    optimize,
    llmOptimize,
    localOptimize: runLocalOptimize,
    getCurrentRole,
    getAllRoles
  })
}

/** 兼容 default 导入形态（类/函数均可被 Cordis loader 识别） */
export default apply
