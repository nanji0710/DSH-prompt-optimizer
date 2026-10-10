/**
 * 浏览器半边 → Node 半边的桥。
 *
 * 客户端服务目录是构建期固定的，出树插件的客户端半边**不能**直接调用宿主
 * 服务；受支持的跨半边通道是 `connection` 服务上的 exact Fetch 路由：
 *   - 宿主侧：`ctx.connection.fetch.register({ path, methods, fetch })`（见 src/index.ts）
 *   - 浏览器侧：直接 `fetch(path, { method: 'POST', body: JSON.stringify(...) })`
 *
 * ⚠️ 曾经用过 `connection.rpc.handle()` / `rpc.call()`，但它在本宿主上必然失败：
 * `register` 内部执行 `owner.effect(() => owner.webServer.register(route))`，`owner`
 * 经 cordis traceable 转发后拿不到 `webServer`，抛 `cannot get property "webServer"
 * without inject` 并被吞掉 —— 通道静默注册失败（端点恒 404/405）。改用
 * `fetch.register` 后不再触碰 `owner.webServer`。详见 src/protocol.ts 头部注释。
 *
 * 端点在页面同源 `/api/...` 上，因此浏览器半边无需任何注入即可 fetch；
 * `isBridgeReady()` 只保留做「宿主是否为 web 宿主」的语义化判断。
 */
import { PRESET_ROLES } from '../config'
import {
  OPTIMIZE_ENDPOINT,
  PROVIDERS_ENDPOINT,
  type OptimizeResponseBody,
  type ProvidersResponseBody,
  type ProviderInfo,
  type SettingsPayload
} from '../protocol'

export type { ProviderInfo, SettingsPayload }

/** 端点是否可用。端点是同源 HTTP 路由，浏览器环境下恒为 true。 */
export function isBridgeReady(): boolean {
  return typeof fetch === 'function'
}

export class OptimizeError extends Error {
  /** 服务端在 LLM 失败时附带的本地规则降级结果，可直接写回输入框。 */
  fallback: string | null

  constructor(message: string, fallback: string | null = null) {
    super(message)
    this.name = 'OptimizeError'
    this.fallback = fallback
  }
}

/** POST 一个 JSON 请求并解析 JSON 响应；HTTP 层错误转成带上下文的异常。 */
async function postJson<T>(path: string, payload: unknown, signal?: AbortSignal): Promise<T> {
  const response = await fetch(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload ?? {}),
    ...(signal ? { signal } : {})
  })
  if (!response.ok) {
    // 尽最大努力取出服务端的结构化错误，取不到就退回状态码
    let detail = ''
    try {
      const body = (await response.json()) as { error?: string }
      detail = body?.error ?? ''
    } catch {
      // 忽略：响应不是 JSON
    }
    throw new OptimizeError(detail || `HTTP ${response.status}`)
  }
  return (await response.json()) as T
}

/** 请求 Node 半边做一次 LLM 改写。失败时抛 OptimizeError（可能带 fallback）。 */
export async function requestOptimize(
  text: string,
  settings?: SettingsPayload,
  signal?: AbortSignal
): Promise<string> {
  let body: OptimizeResponseBody
  try {
    body = await postJson<OptimizeResponseBody>(OPTIMIZE_ENDPOINT, { text, settings }, signal)
  } catch (error) {
    if (error instanceof OptimizeError) throw error
    const hint = error instanceof Error ? error.message : String(error)
    throw new OptimizeError(`调用宿主失败：${hint}`)
  }

  if (!body || typeof body !== 'object') {
    throw new OptimizeError('宿主返回了非预期的响应')
  }
  if (!body.ok) {
    throw new OptimizeError(body.error ?? '未知错误', body.fallback ?? null)
  }
  const optimized = body.optimized
  if (typeof optimized !== 'string' || optimized.trim() === '') {
    throw new OptimizeError('宿主返回了空的优化结果')
  }
  return optimized
}

/** 把客户端当前配置转成请求载荷。 */
export function toSettingsPayload(config: {
  llmProvider?: string
  llmModel?: string
  llmTemperature?: number
  localRules?: any
}): SettingsPayload {
  const rules = config.localRules ?? {}
  const currentId = rules.currentRoleId
  const allRoles: Array<{ id?: string; rolePrompt?: string }> = [
    ...PRESET_ROLES,
    ...(Array.isArray(rules.customRoles) ? rules.customRoles : [])
  ]
  const role = allRoles.find((r) => r?.id === currentId)
  return {
    provider: config.llmProvider ?? '',
    model: config.llmModel ?? '',
    temperature: config.llmTemperature,
    rolePrompt: role?.rolePrompt ?? '',
    localRules: rules
  }
}

/** 拉取宿主已注册的 provider 列表（设置页用来填充下拉框）。 */
export async function requestProviders(): Promise<{
  providers: ProviderInfo[]
  default: { provider?: string; model?: string } | null
}> {
  try {
    const body = await postJson<ProvidersResponseBody>(PROVIDERS_ENDPOINT, {})
    if (body?.ok) {
      return { providers: body.providers ?? [], default: body.default ?? null }
    }
  } catch {
    // 静默失败：设置页仍可手填
  }
  return { providers: [], default: null }
}
