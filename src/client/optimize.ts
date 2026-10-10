/**
 * 浏览器侧优化入口：复用纯函数规则引擎（src/local-optimizer.ts 无任何 Node 依赖）。
 */
import { PRESET_ROLES, type RoleItem } from '../config'
import { localOptimizeText } from '../local-optimizer'
import { getConfig } from './store'

/** 全部可选角色（内置 + 自定义）。 */
export function listRoles(): RoleItem[] {
  const cfg = getConfig()
  return [...PRESET_ROLES, ...(cfg.localRules.customRoles ?? [])]
}

/** 当前生效角色，找不到时退回最后一个内置角色（与 Node 半边一致）。 */
export function resolveRole(): RoleItem {
  const cfg = getConfig()
  const all = listRoles()
  return all.find((role) => role.id === cfg.localRules.currentRoleId)
    ?? PRESET_ROLES[PRESET_ROLES.length - 1]
}

/** 优化一段提示词。 */
export function optimizePrompt(text: string): string {
  const cfg = getConfig()
  return localOptimizeText(text, cfg.localRules, resolveRole())
}
