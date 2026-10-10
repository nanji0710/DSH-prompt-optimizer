/**
 * 浏览器半边与 Node 半边共用的传输协议。
 *
 * 纯常量 + 纯类型，不依赖任何 Node 或浏览器 API，因此两端都能安全 import。
 *
 * 通道形态：Node 半边用 `connection.fetch.register({ path, methods, requestBody, fetch })`
 * 注册一条 exact Fetch 路由，浏览器半边直接 `fetch(path, ...)`。约束来自
 * `assertFetchRoute`：path 必须能通过 `endpointFromPath('/api', path)`，即
 * 以 `/api/` 开头、且每段匹配 /^[A-Za-z0-9_$.-]+$/。
 *
 * ⚠️ 不要改用 `connection.rpc.handle()`（自定义 RPC 通道）：它内部执行
 * `owner.effect(() => owner.webServer.register(route))`，而 `owner` 是 connection
 * 服务的 `this.ctx`，经 cordis traceable 转发到调用方的**影子 ctx** 后拿不到
 * `webServer`，抛 `cannot get property "webServer" without inject`；异常被 cordis
 * 吞掉，路由静默注册失败，且插件照常 ready（表现为端点恒 404/405）。
 */

/** 本插件在 connection `/api` 前缀下的命名空间。 */
export const API_PREFIX = '/api/prompt-optimizer'

/** LLM 改写端点：POST { text, settings } → { ok, optimized } | { ok:false, error, fallback }。 */
export const OPTIMIZE_ENDPOINT = `${API_PREFIX}/optimize`

/** 宿主 provider 列表端点：POST {} → { ok:true, providers, default }。 */
export const PROVIDERS_ENDPOINT = `${API_PREFIX}/providers`

/** 宿主已注册的模型接口（设置页下拉用）。 */
export interface ProviderInfo {
  id: string
  name: string
}

/** 随每次请求上传的本次设置；客户端 localStorage 是设置的唯一来源。 */
export interface SettingsPayload {
  provider?: string
  model?: string
  temperature?: number
  /** 当前选中角色的提示词（设置页可选覆盖）。 */
  rolePrompt?: string
  localRules?: Record<string, unknown>
}

export interface OptimizeRequestBody {
  text?: string
  settings?: SettingsPayload
}

export interface OptimizeResponseBody {
  ok: boolean
  optimized?: string
  error?: string
  /** LLM 失败时 Node 半边一并算好的本地规则结果，可直接写回输入框。 */
  fallback?: string | null
}

export interface ProvidersResponseBody {
  ok: boolean
  providers?: ProviderInfo[]
  default?: { provider?: string; model?: string } | null
  error?: string
}
