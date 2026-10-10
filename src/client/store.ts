/**
 * 浏览器侧配置存储。
 *
 * Node 半边与浏览器半边是两个彼此独立的 cordis 上下文：浏览器半边既拿不到
 * Node 半边 ctx.provide 的服务（packages/client 的服务目录 SERVICE_API 只登记
 * layout/locale/sessions/slots/theme/timer/uiWorkspace/workspaces 八项），也
 * 没有受支持的静态跨半边桥。因此配置与规则引擎整体落在客户端，用 localStorage
 * 持久化。
 */
import { useSyncExternalStore } from 'react'
import { defaultConfig, type PluginConfig } from '../config'

const STORAGE_KEY = 'prompt-optimizer:config'

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function load(): PluginConfig {
  const base = clone(defaultConfig)
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return base
    const parsed = JSON.parse(raw) as Partial<PluginConfig>
    return {
      ...base,
      ...parsed,
      localRules: { ...base.localRules, ...(parsed?.localRules ?? {}) },
    }
  } catch {
    // 隐私模式或 JSON 损坏：退回默认配置，不阻断启动
    return base
  }
}

let config: PluginConfig = load()
const listeners = new Set<() => void>()

/** 当前配置（引用稳定，仅在写入后变化）。 */
export function getConfig(): PluginConfig {
  return config
}

/** 合并写入一份配置补丁并持久化。 */
export function setConfig(patch: Partial<PluginConfig>): void {
  config = {
    ...config,
    ...patch,
    localRules: { ...config.localRules, ...(patch.localRules ?? {}) },
  }
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(config))
  } catch {
    // 配额或隐私模式：内存态仍生效
  }
  listeners.forEach((fn) => fn())
}

/** 订阅配置变化，返回退订函数。 */
export function subscribe(fn: () => void): () => void {
  listeners.add(fn)
  return () => {
    listeners.delete(fn)
  }
}

/** 恢复出厂配置。 */
export function resetConfig(): void {
  config = clone(defaultConfig)
  try {
    window.localStorage.removeItem(STORAGE_KEY)
  } catch {
    // 忽略
  }
  listeners.forEach((fn) => fn())
}

/** React 读取钩子。 */
export function useConfig(): PluginConfig {
  return useSyncExternalStore(subscribe, getConfig, getConfig)
}
