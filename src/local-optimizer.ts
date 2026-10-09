/**
 * 本地正则规则优化引擎
 * 纯函数实现，零 Token 消耗、毫秒级响应，不依赖任何网络服务。
 */
import type { LocalRulesConfig, RoleItem } from './config'

/**
 * 本地规则优化
 * @param text 原始输入文本
 * @param config 本地规则配置
 * @param currentRole 当前生效角色
 * @returns 优化后的文本
 */
export function localOptimize(
  text: string,
  config: LocalRulesConfig,
  currentRole: RoleItem
): string {
  let result = (text || '').trim()
  if (!result) return ''

  // ========== L1 基础清洗 ==========
  if (config.cleanWhitespace) {
    // 合并 3 个及以上换行为 2 个
    result = result.replace(/\n{3,}/g, '\n\n')
    // 去除每行首尾空白
    result = result.replace(/^[ \t]+|[ \t]+$/gm, '')
    // 合并行内连续空格
    result = result.replace(/ {2,}/g, ' ')
  }

  if (config.filterPoliteWords) {
    // 过滤句首客套词
    const politeStart =
      /^(麻烦|帮我|请问|我想|能不能|麻烦你|请你|谢谢|感谢|拜托|您好|你好)[，。：:\s]*/gim
    result = result.replace(politeStart, '')
    // 过滤句尾感谢词
    const politeEnd = /[，。\s]*(谢谢|感谢|拜托了|辛苦了)[。！\s]*$/gim
    result = result.replace(politeEnd, '')
  }

  // ========== L2 格式规范化 ==========
  if (config.normalizeList) {
    // 统一中文/括号序号为 "数字. " 格式
    result = result.replace(/^[（(【\[]?(\d+)[）)】\]、.\s]+/gm, '$1. ')
    // 统一各类项目符号为 "- "
    result = result.replace(/^[—\-*●▪◆•▪]\s+/gm, '- ')
  }

  if (config.autoSplitParagraph) {
    // 句号/分号后强制换行
    result = result.replace(/([。；;])/g, '$1\n')
    result = result.replace(/\n{3,}/g, '\n\n')
  }

  // ========== L3 结构化增强 ==========
  if (config.splitSections) {
    const sectionKeywords = ['需求', '功能', '要求', '问题', '背景', '约束', '交付', '注意']
    sectionKeywords.forEach((keyword) => {
      const reg = new RegExp(`^${keyword}[：:]\\s*`, 'gim')
      result = result.replace(reg, `\n### ${keyword}：\n`)
    })
    result = result.trimStart()
  }

  if (config.appendConstraints && config.constraintsText.trim()) {
    result = result.trimEnd() + '\n\n' + config.constraintsText.trim()
  }

  // ========== L4 角色化注入 ==========
  if (config.enableRoleOptimization && currentRole) {
    result = `角色：${currentRole.name}\n` + result
  }

  return result.trim()
}
