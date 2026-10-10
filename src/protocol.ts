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

/**
 * 指定 provider 的模型清单端点：POST { provider } → { ok:true, models }。
 *
 * 每个模型都带 `reasoning.efforts`（宿主 `ctx.llm.resolveModelInfo` 的答案），
 * 设置页据此渲染「思考强度」下拉 —— 这是修掉 `UNSUPPORTED_REASONING_EFFORT`
 * 的唯一可靠办法：档位不是我们能猜的，必须由模型元数据给出。
 */
export const MODELS_ENDPOINT = `${API_PREFIX}/models`

/** 宿主已注册的模型接口（设置页下拉用）。 */
export interface ProviderInfo {
  id: string
  name: string
}

/** 一个可选的思考强度档位（宿主 `reasoning.efforts` 的条目）。 */
export interface ReasoningEffortInfo {
  id: string
  name: string
  description?: string
}

/** 模型的思考强度元数据；`efforts` 为空表示该模型不支持选择强度。 */
export interface ModelReasoningInfo {
  efforts: ReasoningEffortInfo[]
  defaultEffort?: string
}

/** 宿主已注册的一个模型（设置页下拉用）。 */
export interface ModelInfo {
  id: string
  name: string
  description?: string
  reasoning?: ModelReasoningInfo
}

/** 随每次请求上传的本次设置；客户端 localStorage 是设置的唯一来源。 */
export interface SettingsPayload {
  provider?: string
  model?: string
  /**
   * 本次调用要用的思考强度档位。
   *
   * ⚠️ 必须与所选模型的 `reasoning.efforts` 一致：宿主在 provider I/O 之前就会
   * 用 `resolveCallWithInfo` 校验，不支持的档位直接抛
   * `UNSUPPORTED_REASONING_EFFORT`；档位填错时上游还会回 400
   * 「模型不支持该思考强度，请调整」。
   *
   * 空串 / undefined = 不指定（交给 provider 自己的默认档）。
   */
  reasoningEffort?: string
  temperature?: number
  /** 当前选中角色的提示词（设置页可选覆盖）。 */
  rolePrompt?: string
  localRules?: Record<string, unknown>
  /**
   * 本次请求要不要走大模型。
   *
   * 以前这个字段没上传，Node 半边只能从 `defaultConfig` 取到 `'llm'`，于是
   * 用户在设置页选「本地规则」也照样调模型。现在按请求传上来。
   */
  mode?: OptimizeMode
}

/** 上传的优化模式；`local` 时 Node 半边完全不碰宿主 llm 服务。 */
export type OptimizeMode = 'local' | 'llm'

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

export interface ModelsRequestBody {
  provider?: string
}

export interface ModelsResponseBody {
  ok: boolean
  provider?: string
  models?: ModelInfo[]
  error?: string
}
