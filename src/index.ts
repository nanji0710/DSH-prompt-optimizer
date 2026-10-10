/**
 * 提示词优化助手 - 插件服务端入口（Node 半边）
 *
 * 导出契约（DSH Cordis loader 识别）：
 * - 命名导出 name / inject / apply
 * - 依赖服务通过插件级 `export const inject = [...]` 声明；可选服务用 ctx.inject([...], cb) 延迟注入
 * - 服务通过 ctx.provide() 注册
 *
 * 跨半边通道：浏览器半边无法直接调用 Node 侧服务，因此这里用
 * `ctx.connection.fetch.register({ path, methods, fetch })` 在 `/api` 下注册
 * exact Fetch 路由，浏览器侧直接 `fetch(path, { method: 'POST' })`。
 * 协议常量与类型见 src/protocol.ts（两端共用同一个文件，避免字符串漂移）。
 *
 * 配置来源：**客户端 localStorage 是设置的唯一来源**。用户在设置页填的
 * provider / model / 温度 / 角色，随每次 optimize 请求一并传上来（payload.settings），
 * 因此无需依赖宿主侧的 ctx.config（它不是可注入的服务，且与浏览器端不同源）。
 */
import { localOptimizeText } from './local-optimizer'
import { defaultConfig, PRESET_ROLES } from './config'
import type { PluginConfig, RoleItem, LocalRulesConfig } from './config'
import {
  buildSystemPrompt,
  buildUserPrompt,
  detectLanguage,
  findPlaceholder,
  stripDecoration
} from './prompt'
import {
  MODELS_ENDPOINT,
  OPTIMIZE_ENDPOINT,
  PROVIDERS_ENDPOINT,
  type ModelInfo,
  type ModelReasoningInfo,
  type ModelsRequestBody,
  type OptimizeRequestBody
} from './protocol'

export const name = 'prompt-optimizer'

/** 依赖服务：llm 必需；connection 为 web 宿主专有，按需延迟注入。 */
export const inject = ['llm']

/** 浏览器传来的本次请求设置（可选，留空则回落到 DSH 默认模型）。 */
export interface RequestSettings {
  provider?: string
  model?: string
  /**
   * 思考强度档位。
   *
   * ⚠️ 必须落在该模型 `reasoning.efforts` 里：宿主的 `resolveCallWithInfo` 在发起
   * provider I/O 之前就会校验，不支持的档位直接抛 UNSUPPORTED_REASONING_EFFORT；
   * 部分上游（如 workbuddy）还会回 400「模型不支持该思考强度，请调整」。
   * 留空表示由插件按模型能力自动挑一档。
   */
  reasoningEffort?: string
  temperature?: number
  rolePrompt?: string
  localRules?: Partial<LocalRulesConfig>
  /** 本次请求的优化模式；以前没上传，导致设置页选「本地规则」也照样调模型。 */
  mode?: 'local' | 'llm'
}

/** 把「客户端设置」合并成一份完整配置，缺字段用内置默认值补齐。 */
function mergeSettings(settings?: RequestSettings): PluginConfig {
  const temperature = Number(settings?.temperature)
  const mode = settings?.mode === 'local' || settings?.mode === 'llm' ? settings.mode : undefined
  return {
    ...defaultConfig,
    optimizeMode: mode ?? defaultConfig.optimizeMode,
    llmProvider: settings?.provider ?? defaultConfig.llmProvider,
    llmModel: settings?.model ?? defaultConfig.llmModel,
    llmReasoningEffort:
      typeof settings?.reasoningEffort === 'string'
        ? settings.reasoningEffort
        : defaultConfig.llmReasoningEffort,
    llmTemperature: Number.isFinite(temperature) ? temperature : defaultConfig.llmTemperature,
    localRules: { ...defaultConfig.localRules, ...(settings?.localRules || {}) }
  }
}

export function apply(ctx: any) {
  const getAllRoles = (config: PluginConfig): RoleItem[] => [
    ...PRESET_ROLES,
    ...(config.localRules.customRoles || [])
  ]

  /** 当前生效角色：优先取配置里选中的，找不到则回落到内置「通用助手」。 */
  const getCurrentRole = (config: PluginConfig): RoleItem => {
    const allRoles = getAllRoles(config)
    return (
      allRoles.find((r) => r.id === config.localRules.currentRoleId) ||
      PRESET_ROLES[PRESET_ROLES.length - 1]
    )
  }

  /** 请求级角色提示词：设置页传了就用它，否则用本地规则里选中的角色。 */
  const resolveRole = (config: PluginConfig, settings?: RequestSettings): RoleItem => {
    const inline = (settings?.rolePrompt || '').trim()
    const role = getCurrentRole(config)
    if (!inline) return role
    return { ...role, rolePrompt: inline }
  }

  /**
   * 解析本次改写要使用的 provider / model：
   * 客户端设置优先；留空则回落到 DSH 当前的默认模型选择。
   */
  const resolveRoute = (config: PluginConfig): { provider: string; model: string } => {
    let provider = (config.llmProvider || '').trim()
    let model = (config.llmModel || '').trim()
    if (provider && model) return { provider, model }

    const selection = ctx.get?.('agentDefaultModel')?.currentSelection?.()
    if (selection?.provider) provider = provider || selection.provider
    if (selection?.model) model = model || selection.model
    if (provider && model) return { provider, model }

    // 最后兜底：取第一个已注册 adapter 的 provider
    const providers = ctx.llm?.listProviders?.() ?? []
    return { provider: provider || providers[0]?.id || 'deepseek-official', model }
  }

  /**
   * 列出某个 provider 支持的模型，并附带每个模型的思考强度档位。
   *
   * 档位只能从 `resolveModelInfo` 得到（`listModels` 返回的条目**不含** reasoning
   * 元数据），而设置页的「思考强度」下拉必须严格来自这里：手填一个模型不支持的
   * 档位，宿主的 `resolveCallWithInfo` 会在 provider I/O 之前就抛
   * UNSUPPORTED_REASONING_EFFORT，workbuddy 这类上游还会直接回 400
   * 「模型不支持该思考强度，请调整」。
   */
  const listModels = async (provider: string, signal?: AbortSignal): Promise<ModelInfo[]> => {
    const llm = ctx.get?.('llm') ?? ctx.llm
    const raw: any[] = (await llm?.listModels?.(provider)) ?? []
    const models: ModelInfo[] = []
    // 逐个补齐能力元数据；限制并发，避免 provider 有上百个模型时打爆上游。
    const CONCURRENCY = 6
    for (let i = 0; i < raw.length; i += CONCURRENCY) {
      const slice = raw.slice(i, i + CONCURRENCY)
      const resolved = await Promise.all(
        slice.map(async (item): Promise<ModelInfo | null> => {
          const id = String(item?.id ?? '')
          if (!id) return null
          const info: ModelInfo = { id, name: String(item?.name ?? id) }
          if (item?.description) info.description = String(item.description)
          try {
            const detail = await llm?.resolveModelInfo?.(provider, id, signal)
            if (detail?.reasoning) info.reasoning = detail.reasoning as ModelReasoningInfo
          } catch {
            // 单个模型的元数据读取失败不影响整张列表（该项就没有强度下拉）
          }
          return info
        })
      )
      for (const info of resolved) if (info) models.push(info)
    }
    return models
  }

  /**
   * 解析本次请求实际要用的思考强度档位。
   *
   * 以 `resolveModelInfo` 的元数据为准做校验：
   * - 用户选的档位在 `efforts` 里 → 原样使用；
   * - 不在 → 记一条 warn 并退回自动档（绝不把不支持的档位传给宿主）；
   * - 读不到元数据 → 本次**不传** `reasoningEffort`，让 provider 用自己的默认档
   *   （不传永远安全：宿主的档位校验只在显式传值时才触发）。
   */
  const resolveReasoningEffort = async (
    llm: any,
    provider: string,
    model: string,
    config: PluginConfig,
    signal?: AbortSignal
  ): Promise<{ effort?: string; fallbacks?: string[]; warning?: string }> => {
    let info: ModelReasoningInfo | undefined
    try {
      const detail = await llm?.resolveModelInfo?.(provider, model, signal)
      info = detail?.reasoning as ModelReasoningInfo | undefined
    } catch (error) {
      return {
        warning: `无法读取模型 "${model}" 的能力元数据（${
          error instanceof Error ? error.message : String(error)
        }），本次不指定思考强度`
      }
    }

    const efforts = info?.efforts ?? []
    // 自动档：优先模型声明的默认档，否则取它支持的最轻一档。
    // `off` 放在最后考虑 —— 它在不少上游的 wire 映射里不被接受。
    const auto = info?.defaultEffort ?? efforts.find((e) => e.id !== 'off')?.id
    // 备选档：元数据说支持、但上游可能仍拒绝，按「默认档 → 其余非 off 档」排序。
    const fallbacks = (() => {
      const order = [auto, ...efforts.map((e) => e.id)]
      const out: string[] = []
      for (const id of order) {
        if (!id || id === 'off' || out.includes(id)) continue
        out.push(id)
      }
      return out
    })()

    const wanted = (config.llmReasoningEffort || '').trim()
    if (wanted) {
      if (efforts.some((e) => e.id === wanted)) return { effort: wanted, fallbacks }
      return {
        effort: auto,
        fallbacks,
        warning: `模型 "${model}" 不支持思考强度 "${wanted}"，已改用自动档 "${
          auto ?? '（无）'
        }"（可选：${efforts.map((e) => e.id).join(' / ') || '无'}）`
      }
    }

    return { effort: auto, fallbacks }
  }

  /**
   * LLM 深度优化：调用 DSH 已接入的模型改写提示词。
   * 失败时抛错，由调用方决定是否降级到本地规则。
   */
  const llmOptimize = async (
    content: string,
    config: PluginConfig,
    role: RoleItem,
    signal?: AbortSignal,
    route?: { provider: string; model: string }
  ): Promise<string> => {
    const cleaned = content.trim()
    if (!cleaned) return ''
    if ([...cleaned].length < 3) return cleaned

    const llm = ctx.get?.('llm') ?? ctx.llm
    if (!llm?.stream) {
      throw new Error('llm service unavailable')
    }

    const { provider, model } = route ?? resolveRoute(config)
    if (!model) {
      throw new Error('未解析到可用模型：请在插件设置里填写模型名称，或先为 DSH 配置默认模型')
    }

    const lang = detectLanguage(cleaned)
    const rolePrompt = config.localRules.enableRoleOptimization ? role.rolePrompt : ''
    const system = buildSystemPrompt(lang, rolePrompt)

    const options: Record<string, unknown> = {
      provider,
      model,
      system,
      messages: [{ role: 'user', content: [{ type: 'text', text: buildUserPrompt(cleaned, lang) }] }]
    }
    const temperature = Number(config.llmTemperature)
    if (Number.isFinite(temperature)) options.temperature = temperature
    if (signal) options.signal = signal

    // 思考强度：必须落在模型声明的档位里，否则宿主在 provider I/O 之前就拒绝
    // （UNSUPPORTED_REASONING_EFFORT），部分上游还会回 400「模型不支持该思考强度」。
    // 校验失败时退回自动档，读不到元数据时这一次干脆不传（不传永远安全）。
    const effort = await resolveReasoningEffort(llm, provider, model, config, signal)
    if (effort.warning) ctx.logger?.warn?.(`prompt-optimizer: ${effort.warning}`)
    if (effort.effort) options.reasoningEffort = effort.effort

    // 分片累加：text-delta 携带正文增量，finish 结束流。
    // ⚠️ finish 分片把终止结果放在 **reason** 下（`{ type:'finish', reason:{ kind, failure } }`），
    // 不是 `chunk.kind` / `chunk.failure` —— 按后者读会永远拿到 undefined，把
    // MISSING_CREDENTIAL / RATE_LIMIT 之类的真实原因吞掉，只剩一句「模型未返回内容」。
    const drain = async (opts: Record<string, unknown>) => {
      let text = ''
      let reasoningChars = 0
      let finish: any = null
      const chunkTypes = new Set<string>()
      for await (const chunk of llm.stream(opts)) {
        if (chunk?.type) chunkTypes.add(String(chunk.type))
        if (chunk?.type === 'text-delta') {
          text += chunk.text ?? ''
        } else if (chunk?.type === 'reasoning-delta') {
          reasoningChars += (chunk.text ?? '').length
        } else if (chunk?.type === 'finish') {
          finish = chunk
        }
      }
      return { text, reasoningChars, finish, chunkTypes }
    }

    let result = await drain(options)
    let usedEffort = effort.effort

    // ★ 元数据声明支持的档位，上游仍可能拒绝。实测 workbuddy 的
    // deepseek-v4.1-flash **声明**支持 `off`，但 wire 上给 `off` 会回
    // 400「模型不支持该思考强度，请调整」，finish 里零正文。
    // 处理方式：换成元数据里的**另一个档**重试（不是删掉 reasoningEffort）——
    // 删掉会让 pi-ai 走 `!options.reasoningEffort` 那条分支，把模型的
    // `thinkingLevelMap.off` 自动写到 wire 上，等于又发了一次 `off`，必然再错一次。
    if (!result.text.trim() && usedEffort) {
      const failureMessage = String(result.finish?.reason?.failure?.message ?? '')
      const rejectedEffort = /思考强度|reasoning.?effort|thinking/i.test(failureMessage)
      if (rejectedEffort) {
        for (const candidate of effort.fallbacks ?? []) {
          if (candidate === usedEffort) continue
          ctx.logger?.warn?.(
            `prompt-optimizer: 模型 "${model}" 拒绝了思考强度 "${usedEffort}"（${failureMessage.slice(
              0,
              120
            )}），改用 "${candidate}" 重试`
          )
          result = await drain({ ...options, reasoningEffort: candidate })
          usedEffort = candidate
          if (result.text.trim()) break
          const nextMessage = String(result.finish?.reason?.failure?.message ?? '')
          if (!/思考强度|reasoning.?effort|thinking/i.test(nextMessage)) break
        }
      }
    }

    const { text, reasoningChars, finish, chunkTypes } = result

    if (!text.trim()) {
      const reason = finish?.reason
      const detail: string[] = []
      if (reason) {
        detail.push(
          `finish.kind=${String(reason.kind)}` +
            (reason.failure?.code ? ` code=${String(reason.failure.code)}` : '') +
            (reason.failure?.message ? ` message=${String(reason.failure.message)}` : '')
        )
      } else if (finish) {
        detail.push(`finish 缺少 reason：${JSON.stringify(finish).slice(0, 300)}`)
      } else {
        detail.push('未收到 finish 分片')
      }
      if (reasoningChars > 0) detail.push(`思考内容 ${reasoningChars} 字符但无正文`)
      detail.push(`chunks=[${[...chunkTypes].join(',')}]`)
      throw new Error(`模型未返回正文（${detail.join('；')}）`)
    }

    const optimized = stripDecoration(text)

    // ★ 规格 §六 验收标准 1：输出里不得出现任何占位符。
    // system prompt 已明确禁止，但模型偶尔仍会写出 [待补充:表名] 这类标记，
    // 且它恰好是本插件 v0.2 最被诟病的问题。这里做一次兜底拦截：命中就抛错，
    // 由调用方降级到本地规则（本地引擎保证零占位符），而不是把脏结果写回输入框。
    const placeholder = findPlaceholder(optimized)
    if (placeholder) {
      throw new Error(
        `模型输出里仍有占位符 ${JSON.stringify(placeholder)}，已放弃该结果并降级为本地规则`
      )
    }

    // 篇幅提示（规格 §4.1 规则 2：不超过原文 3 倍）。只记日志不拦截：
    // 「原文清晰时返回原文」这类正确行为也可能略超比例，硬拦会误伤。
    const ratio = [...cleaned].length > 0 ? [...optimized].length / [...cleaned].length : 1
    if (ratio > 3.5) {
      ctx.logger?.warn?.(
        `prompt-optimizer: 模型输出 ${[...optimized].length} 字，为原文的 ${ratio.toFixed(1)} 倍，可能仍在套模板`
      )
    }

    return optimized
  }

  /**
   * 依次尝试的 provider 列表。
   *
   * 为什么需要：DSH 里不同 provider 各自持有自己的凭证。默认选择（或列表首个）
   * 常常是 deepseek-official，而它需要 DEEPSEEK_API_KEY；用户真正登录过的往往是
   * deepseek-account。若只试第一个，用户会看到「no API key」而明明有可用账号。
   * 因此：首选路由失败且错误属于「路由/凭证不可用」时，继续尝试其余已注册 provider。
   */
  const candidateRoutes = (config: PluginConfig): Array<{ provider: string; model: string }> => {
    const preferred = resolveRoute(config)
    const all: Array<{ provider: string; model: string }> = []
    if (preferred.provider) all.push(preferred)
    for (const p of ctx.llm?.listProviders?.() ?? []) {
      const id = p?.id ?? p?.provider
      if (!id || all.some((r) => r.provider === id)) continue
      // 复用首选路由解析出的模型名：备选 provider 自己没有配置时，
      // 空模型会被 llmOptimize 直接拒绝，导致「有可用账号却报未解析到模型」。
      all.push({ provider: id, model: preferred.model })
    }
    return all
  }

  /** 该错误是否值得换个 provider 重试（凭证缺失 / 路由不存在）。 */
  const isRouteUnavailable = (error: unknown): boolean => {
    const message = error instanceof Error ? error.message : String(error)
    return /MISSING_CREDENTIAL|INVALID_CREDENTIAL|NO_ADAPTER|AUTH|no API key/i.test(message)
  }

  /**
   * 统一入口：按配置选择 LLM 或本地规则。
   * LLM 失败时不静默，抛出的错误消息里带上原因；降级结果由 HTTP 端点的 fallback 字段返回。
   */
  const optimize = async (
    content: string,
    settings?: RequestSettings,
    signal?: AbortSignal
  ): Promise<string> => {
    const config = mergeSettings(settings)
    const role = resolveRole(config, settings)
    if (config.optimizeMode === 'llm') {
      const routes = candidateRoutes(config)
      let lastError: unknown = null
      for (let i = 0; i < routes.length; i += 1) {
        try {
          const result = await llmOptimize(content, config, role, signal, routes[i])
          if (i > 0) {
            ctx.logger?.info?.(
              `prompt-optimizer: 首选 provider 不可用，已改用 "${routes[i].provider}"`
            )
          }
          return result
        } catch (error) {
          lastError = error
          // 只对「路由不可用」继续换下一个；内容类失败（如上下文超限）直接上报
          if (!isRouteUnavailable(error) || i === routes.length - 1) break
          ctx.logger?.warn?.(
            `prompt-optimizer: provider "${routes[i].provider}" 不可用，尝试下一个：${
              error instanceof Error ? error.message : String(error)
            }`
          )
        }
      }
      const hint = lastError instanceof Error ? lastError.message : String(lastError)
      throw new Error(`LLM 优化失败：${hint}`)
    }
    return localOptimizeText(content, config.localRules, role)
  }

  // 注册服务到宿主（用 ctx.provide，与官方插件一致）
  ctx.provide('promptOptimizer', {
    optimize,
    llmOptimize,
    getCurrentRole: (settings?: RequestSettings) => getCurrentRole(mergeSettings(settings)),
    getAllRoles: (settings?: RequestSettings) => getAllRoles(mergeSettings(settings))
  })

  /** 统一的 JSON 响应（浏览器半边按 ok 字段判断成败）。 */
  const json = (body: unknown, status = 200): Response =>
    new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json; charset=utf-8' }
    })

  /**
   * 注册 HTTP 端点，供浏览器半边 fetch 调用。
   *
   * 用 `connection.fetch.register`（exact Fetch 路由）而**不是** `connection.rpc.handle`：
   * 后者内部执行 `owner.effect(() => owner.webServer.register(route))`，`owner` 是
   * connection 服务的 this.ctx，经 cordis traceable 转发到调用方影子 ctx 后拿不到
   * webServer，抛 `cannot get property "webServer" without inject` 并被吞掉 —— 路由
   * 静默注册失败，表现为端点恒 404/405。`fetch.register` 只碰 owner.effect 与
   * connection 自己的 fetchRoutes 表，没有这个问题。
   *
   * connection 是 web 宿主专有服务（TUI 等没有 web 面），故放在独立 inject 里。
   */
  ctx.inject(['connection'], (connCtx: any) => {
    const connection = connCtx.connection
    if (!connection?.fetch?.register) {
      ctx.logger?.warn?.('prompt-optimizer: connection 服务没有 fetch.register，HTTP 端点未注册')
      return
    }

    /** POST /api/prompt-optimizer/optimize：{ text, settings } → { ok, optimized }。 */
    connection.fetch.register({
      path: OPTIMIZE_ENDPOINT,
      methods: ['POST'],
      requestBody: 'buffered',
      fetch: async (request: Request): Promise<Response> => {
        let body: OptimizeRequestBody
        try {
          body = (await request.json()) as OptimizeRequestBody
        } catch {
          return json({ ok: false, error: '请求体不是合法 JSON' }, 400)
        }
        const text = typeof body?.text === 'string' ? body.text : ''
        if (!text.trim()) return json({ ok: false, error: '输入内容为空' }, 400)

        try {
          const optimized = await optimize(text, body?.settings as RequestSettings | undefined, request.signal)
          return json({ ok: true, optimized })
        } catch (error) {
          // LLM 失败时不静默：一并返回本地规则结果，浏览器半边直接采用
          const hint = error instanceof Error ? error.message : String(error)
          const config = mergeSettings(body?.settings as RequestSettings | undefined)
          const role = resolveRole(config, body?.settings as RequestSettings | undefined)
          let fallback: string | null = null
          try {
            fallback = localOptimizeText(text, config.localRules, role)
          } catch {
            fallback = null
          }
          return json({ ok: false, error: hint, fallback }, 200)
        }
      }
    })

    /** POST /api/prompt-optimizer/providers：{} → { ok, providers, default }。 */
    connection.fetch.register({
      path: PROVIDERS_ENDPOINT,
      methods: ['POST'],
      requestBody: 'buffered',
      fetch: async (): Promise<Response> => {
        try {
          const providers = (ctx.llm?.listProviders?.() ?? []).map((p: any) => ({
            id: p.id ?? p.provider ?? '',
            name: p.name ?? p.id ?? p.provider ?? ''
          }))
          const selection = ctx.get?.('agentDefaultModel')?.currentSelection?.() ?? null
          return json({ ok: true, providers, default: selection })
        } catch (error) {
          const hint = error instanceof Error ? error.message : String(error)
          return json({ ok: false, error: hint }, 200)
        }
      }
    })

    /** POST /api/prompt-optimizer/models：{ provider } → { ok, models }。 */
    connection.fetch.register({
      path: MODELS_ENDPOINT,
      methods: ['POST'],
      requestBody: 'buffered',
      fetch: async (request: Request): Promise<Response> => {
        let body: ModelsRequestBody
        try {
          body = (await request.json()) as ModelsRequestBody
        } catch {
          body = {}
        }
        const provider = typeof body?.provider === 'string' ? body.provider.trim() : ''
        if (!provider) {
          const selection = ctx.get?.('agentDefaultModel')?.currentSelection?.()
          const fallback = selection?.provider ?? (ctx.llm?.listProviders?.() ?? [])[0]?.id ?? ''
          if (!fallback) return json({ ok: true, provider: '', models: [] })
          try {
            return json({ ok: true, provider: fallback, models: await listModels(fallback, request.signal) })
          } catch (error) {
            const hint = error instanceof Error ? error.message : String(error)
            return json({ ok: false, provider: fallback, error: hint }, 200)
          }
        }
        try {
          return json({ ok: true, provider, models: await listModels(provider, request.signal) })
        } catch (error) {
          const hint = error instanceof Error ? error.message : String(error)
          return json({ ok: false, provider, error: hint }, 200)
        }
      }
    })

    ctx.logger?.info?.(
      `prompt-optimizer: HTTP 端点已注册 ${OPTIMIZE_ENDPOINT} / ${PROVIDERS_ENDPOINT} / ${MODELS_ENDPOINT}`
    )
  })
}
