/**
 * 提示词优化助手 - 插件服务端入口
 *
 * 导出契约（照抄 DSH 官方插件 dsh-cost-meter 的形态）：
 * - 命名导出 name / apply（DSH Cordis loader 识别）
 * - 依赖通过 ctx.inject(['config'], cb) 延迟注入（不能在 apply 顶层直接访问 ctx.config）
 * - 服务通过 ctx.provide() 注册
 */
import { localOptimize } from './local-optimizer'
import { defaultConfig, PRESET_ROLES } from './config'
import type { PluginConfig, RoleItem } from './config'

export const name = 'prompt-optimizer'

/** 基础优化方法论模板（四步标准化优化） */
const BASE_OPTIMIZE_TEMPLATE = `请严格按照以下4个步骤优化用户输入，直接输出优化后的最终内容，不要输出解释、不要输出思考过程。
优化步骤：
1. 【核心诉求提炼】用一句话明确最终目标，去掉所有口语、寒暄、铺垫。
2. 【结构化拆解】将需求拆分为多个要点，用编号列表清晰呈现。
3. 【歧义消除与补全】识别模糊表述，补充合理的默认上下文，明确边界条件。
4. 【指令规范化】整理为标准清晰的指令格式，输出可直接执行的内容。
注意：禁止改变用户原始需求，只优化表达形式和清晰度。`

export function apply(ctx: any) {
  // 延迟注入 config 服务：等 config 就绪后再执行回调
  ctx.inject(['config'], (c: any) => {
    c.config.defaults(defaultConfig)

    /** 读取当前配置，与默认值浅合并防御缺字段 */
    const getConfig = (): PluginConfig => {
      const cfg = c.config.get()
      return {
        ...defaultConfig,
        ...cfg,
        localRules: { ...defaultConfig.localRules, ...(cfg?.localRules || {}) }
      }
    }

    /** 当前生效角色 */
    const getCurrentRole = (): RoleItem => {
      const config = getConfig()
      const allRoles = [...PRESET_ROLES, ...config.localRules.customRoles]
      return (
        allRoles.find((r) => r.id === config.localRules.currentRoleId) ||
        PRESET_ROLES[PRESET_ROLES.length - 1]
      )
    }

    const getAllRoles = (): RoleItem[] => {
      const config = getConfig()
      return [...PRESET_ROLES, ...config.localRules.customRoles]
    }

    const stripCodeFence = (input: string): string => {
      let result = input.trim()
      if (/^```[a-zA-Z]*\n[\s\S]*```$/.test(result)) {
        result = result.replace(/^```[a-zA-Z]*\n?/, '').replace(/```$/, '')
      }
      return result.trim()
    }

    /** LLM 深度优化：复用 DSH 已接入的模型（可选服务，动态探测） */
    const llmOptimize = async (content: string, currentRole: RoleItem): Promise<string> => {
      const config = getConfig()
      const cleaned = content.trim().replace(/\n{3,}/g, '\n\n')
      if (!cleaned) return ''
      if (cleaned.length < 10) return cleaned

      const systemPrompt = config.localRules.enableRoleOptimization
        ? `${currentRole.rolePrompt}\n\n${BASE_OPTIMIZE_TEMPLATE}`
        : BASE_OPTIMIZE_TEMPLATE

      // llm 是可选服务，用 ctx.get 动态探测
      const llm = ctx.get?.('llm')
      if (!llm?.chat) {
        return localOptimize(content, config.localRules, currentRole)
      }

      try {
        const response = await llm.chat({
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: `待优化内容：\n${cleaned}` }
          ],
          temperature: config.llmTemperature,
          model: config.llmModel
        })
        return stripCodeFence(response?.content || cleaned)
      } catch (error) {
        console.error('[提示词优化] LLM 调用失败，降级为本地优化：', error)
        return localOptimize(content, config.localRules, currentRole)
      }
    }

    const runLocalOptimize = (content: string): string => {
      const config = getConfig()
      return localOptimize(content, config.localRules, getCurrentRole())
    }

    const optimize = async (content: string): Promise<string> => {
      const config = getConfig()
      const currentRole = getCurrentRole()
      if (config.optimizeMode === 'llm' && config.llmModel.trim()) {
        return llmOptimize(content, currentRole)
      }
      return localOptimize(content, config.localRules, currentRole)
    }

    // 注册服务到宿主（用 ctx.provide，与官方插件一致）
    ctx.provide('promptOptimizer', {
      optimize,
      llmOptimize,
      localOptimize: runLocalOptimize,
      getCurrentRole,
      getAllRoles
    })
  })
}
