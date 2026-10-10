/**
 * 冒烟测试：mock DSH 宿主（cordis / ctx），验证插件核心逻辑
 * 运行：node scripts/smoke-test.cjs
 *
 * ⚠️ 这份测试对齐的是 **v0.3.x 的实际契约**，不是 v0.1.x：
 * - 侧通道是 `ctx.connection.fetch.register` 注册的 /api 路由（不是 rpc.handle）；
 * - 宿主 LLM 入口是 `ctx.llm.stream()` 异步迭代（**没有** `llm.chat()` 这个方法）；
 * - 本地引擎输出与 LLM 侧同形：无「要求：」块、无 `- ` 列表、短诉求单句内联；
 * - 角色注入只加 1 行且不带「角色：」前缀（默认还关着）。
 */
const Module = require('module')
const path = require('path')
const assert = require('assert')

// 1) mock 宿主模块 cordis
const originalLoad = Module._load
Module._load = function (request, parent, isMain) {
  if (request === 'cordis') {
    class Plugin {
      constructor(ctx) { this.ctx = ctx }
      apply() {}
    }
    return { Plugin, __esModule: true, default: Plugin }
  }
  return originalLoad.apply(this, arguments)
}

const dist = path.join(__dirname, '..', 'dist')
const mod = require(path.join(dist, 'index.js'))
const apply = mod.apply
const inject = mod.inject
const { defaultConfig, PRESET_ROLES } = require(path.join(dist, 'config.js'))
const { findPlaceholder } = require(path.join(dist, 'prompt.js'))

// 2) 构造 mock ctx（模拟 Cordis ctx.provide / ctx.inject / ctx.get）
const config = JSON.parse(JSON.stringify(defaultConfig))

let streamCalls = []
let streamHandler = async () => []
let modelInfo = { reasoning: { efforts: [{ id: 'high', name: 'high' }], defaultEffort: 'high' } }
const warnings = []

const llmMock = {
  stream(options) {
    streamCalls.push(options)
    const callIndex = streamCalls.length
    return (async function* () {
      for (const chunk of await streamHandler(options, callIndex)) yield chunk
    })()
  },
  async resolveModelInfo() { return modelInfo },
  async listModels() { return [{ id: 'mock-model', name: 'Mock Model' }] },
  listProviders() { return [{ provider: 'mock-provider', name: 'Mock Provider' }] }
}

const registeredFetchRoutes = []
const connMock = {
  fetch: {
    register(route) { registeredFetchRoutes.push(route) }
  }
}

const ctx = {
  provide: (name, impl) => { registered[name] = impl },
  get: (name) => (name === 'llm' ? llmMock : undefined),
  // Cordis 延迟注入：记录参数并立即执行回调
  inject: (services, cb) => {
    injectArgs.push(services)
    cb(services.includes('connection') ? { connection: connMock } : {})
  },
  logger: {
    info: () => {},
    warn: (message) => { warnings.push(String(message)) }
  }
}
const registered = {}
const injectArgs = []

// 3) 执行插件 apply
apply(ctx)

let passed = 0
const ok = (name, cond, detail) => {
  assert.ok(cond, detail ? `${name} :: ${JSON.stringify(detail)}` : name)
  console.log('  PASS  ' + name)
  passed++
}

const textChunks = (text) => [
  { type: 'text-delta', text },
  { type: 'finish', reason: { kind: 'stop' } }
]

;(async () => {
  /* ---- 插件契约 ---- */
  ok('插件级 inject 声明了 llm', Array.isArray(inject) && inject.includes('llm'), inject)
  ok('connection 走延迟注入（web 宿主专有）', injectArgs.some((s) => s.includes('connection')), injectArgs)
  const service = registered.promptOptimizer
  ok('服务 promptOptimizer 已注册且带 optimize/llmOptimize', typeof service?.optimize === 'function' && typeof service?.llmOptimize === 'function')
  ok('getAllRoles 返回内置 6 个角色', service.getAllRoles().length === 6, service.getAllRoles().length)
  const generalRole = service.getCurrentRole()
  ok('默认角色是通用角色', generalRole.id === PRESET_ROLES.at(-1).id, generalRole.id)
  ok('通用角色的 rolePrompt 为空（默认不注入任何角色行）', generalRole.rolePrompt === '', generalRole.rolePrompt)

  /* ---- HTTP 端点注册（v0.3 侧通道） ---- */
  const paths = registeredFetchRoutes.map((r) => r.path).sort()
  ok('注册了 optimize / providers / models 三个 /api 路由',
    registeredFetchRoutes.length === 3 &&
      paths.every((p) => p.startsWith('/api/prompt-optimizer/')) &&
      paths.some((p) => p.endsWith('/optimize')) &&
      paths.some((p) => p.endsWith('/providers')) &&
      paths.some((p) => p.endsWith('/models')),
    paths)
  ok('所有路由都是 POST + buffered 请求体',
    registeredFetchRoutes.every((r) => r.methods.includes('POST') && r.requestBody === 'buffered'),
    registeredFetchRoutes.map((r) => ({ methods: r.methods, requestBody: r.requestBody })))

  /* ---- 本地引擎：输出形态与 LLM 侧一致 ---- */
  const local = (text, rules) => service.optimize(text, { mode: 'local', localRules: rules })

  const reconcile = await local('拼多多的GMV和去退数量，结果表和底表有差异，你查一下')
  ok('对账类输出与 LLM 侧同形（首行句式）', reconcile.startsWith('请排查拼多多（GMV、去退数量）在结果表与底表间差异：'), reconcile)
  ok('对账类输出用 1./2./3. 编号而非 - 列表', /^1\. /m.test(reconcile) && !/^- /m.test(reconcile), reconcile)
  ok('输出不再出现「要求：」样板', !reconcile.includes('要求：'), reconcile)
  ok('对账类零占位符', findPlaceholder(reconcile) === null, findPlaceholder(reconcile))

  const crawler = await local('写个爬虫')
  ok('短诉求单句内联（不换行、不加标题）',
    !crawler.includes('\n') && crawler.startsWith('写个爬虫：') && crawler.endsWith('。'), crawler)

  const punished = await local('你好，麻烦帮我看下这个报表哪里有问题，谢谢')
  ok('句首客套与句尾感谢都被清掉', !punished.includes('麻烦') && !punished.includes('谢谢'), punished)

  ok('空内容返回空字符串', (await local('   ')) === '', null)
  ok('过短内容原样返回', (await local('嗯')) === '嗯', null)
  ok('纯标点原样返回（无信息可抽取）', (await local('。。。')) === '。。。', null)

  /* ---- 本地引擎：幂等 ---- */
  const once = await local(reconcile)
  ok('本地引擎幂等（二次优化不再追加）', once === reconcile, { once, reconcile })

  /* ---- 角色注入 ---- */
  ok('角色注入默认关闭（选了角色也不出现）',
    !(await local('帮我看看这个报表', { enableRoleOptimization: false, currentRoleId: 'data-analyst' })).includes('数据分析师'))

  const withRole = await local('帮我看看这个报表', { enableRoleOptimization: true, currentRoleId: 'data-analyst' })
  ok('开启角色注入后首行是角色提示词（不带「角色：」前缀、只 1 行）',
    withRole.startsWith('你是一名数据分析师，回答时先给结论再给依据。\n') && !withRole.startsWith('角色：'), withRole)

  /* ---- 自定义角色 ---- */
  const custom = { id: 'custom-1', name: '测试工程师', description: 'd', rolePrompt: '你是测试工程师' }
  const withCustom = await local('帮我看看这个报表', {
    enableRoleOptimization: true,
    currentRoleId: 'custom-1',
    customRoles: [custom]
  })
  ok('自定义角色可被查找并注入', withCustom.startsWith('你是测试工程师\n'), withCustom)
  ok('自定义角色计入 getAllRoles',
    service.getAllRoles({ localRules: { customRoles: [custom] } }).length === 7, null)

  /* ---- LLM 路径：llm.stream 分片累加 + 代码围栏剥离 ---- */
  streamCalls = []
  streamHandler = async () => textChunks('\n```\nLLM优化结果\n```\n')
  const llmOut = await service.optimize('请帮我优化这段需求描述，包括实现方案与细节要求', {
    mode: 'llm',
    provider: 'mock-provider',
    model: 'mock-model'
  })
  ok('LLM 模式调用了 llm.stream（不是 llm.chat）', streamCalls.length === 1, streamCalls.length)
  ok('LLM 请求带上了 system + messages',
    typeof streamCalls[0].system === 'string' && Array.isArray(streamCalls[0].messages), null)
  ok('LLM 结果剥离了代码块包裹', llmOut === 'LLM优化结果', llmOut)

  /* ---- 思考强度：不支持的档位退回自动档 ---- */
  warnings.length = 0
  modelInfo = { reasoning: { efforts: [{ id: 'off', name: 'off' }, { id: 'high', name: 'high' }], defaultEffort: 'high' } }
  streamCalls = []
  streamHandler = async () => textChunks('改写结果')
  await service.optimize('请帮我优化这段需求描述，包括实现方案与细节要求', {
    mode: 'llm',
    provider: 'mock-provider',
    model: 'mock-model',
    reasoningEffort: 'max'
  })
  ok('不支持的档位被换成自动档且记了 warn',
    streamCalls[0].reasoningEffort === 'high' && warnings.some((w) => w.includes('不支持思考强度')),
    { sent: streamCalls[0].reasoningEffort, warnings })

  /* ---- 思考强度：元数据说支持但上游拒绝 → 换档重试（v0.3.2 的核心修复） ---- */
  // 真实场景（workbuddy 的 deepseek-v4.1-flash）就是「声明支持、上游拒绝」，
  // 且**档位不止两个**——重试要换到元数据里的另一个非 off 档，所以这里给三个。
  warnings.length = 0
  modelInfo = {
    reasoning: {
      efforts: [{ id: 'off' }, { id: 'low' }, { id: 'high' }, { id: 'max' }].map((e) => ({ ...e, name: e.id })),
      defaultEffort: 'high'
    }
  }
  streamCalls = []
  streamHandler = async (_options, callIndex) => {
    if (callIndex === 1) {
      return [{ type: 'finish', reason: { kind: 'error', failure: { code: 'INVALID_REQUEST', message: '模型不支持该思考强度，请调整' } } }]
    }
    return textChunks('重试后的改写结果')
  }
  const retried = await service.optimize('请帮我优化这段需求描述，包括实现方案与细节要求', {
    mode: 'llm',
    provider: 'mock-provider',
    model: 'mock-model'
  })
  ok('上游拒绝档位后换档重试并拿到正文',
    retried === '重试后的改写结果' && streamCalls.length === 2 &&
      streamCalls[0].reasoningEffort === 'high' && streamCalls[1].reasoningEffort === 'low' &&
      warnings.some((w) => w.includes('拒绝了思考强度')),
    { retried, efforts: streamCalls.map((c) => c.reasoningEffort), warnings })

  /* ---- LLM 零正文：错误信息必须带上真实原因 ---- */
  streamCalls = []
  streamHandler = async () => [
    { type: 'usage' },
    { type: 'finish', reason: { kind: 'error', failure: { code: 'RATE_LIMIT', message: 'quota exceeded' } } }
  ]
  let zeroBodyError = null
  try {
    await service.optimize('请帮我优化这段需求描述，包括实现方案与细节要求', {
      mode: 'llm',
      provider: 'mock-provider',
      model: 'mock-model'
    })
  } catch (error) {
    zeroBodyError = error
  }
  ok('零正文时报错并带上 finish 的真实 code/message',
    zeroBodyError && /模型未返回正文/.test(zeroBodyError.message) &&
      /RATE_LIMIT/.test(zeroBodyError.message) && /quota exceeded/.test(zeroBodyError.message),
    zeroBodyError?.message)

  /* ---- 占位符兜底拦截（规格 §六 验收标准 1） ---- */
  streamCalls = []
  streamHandler = async () => textChunks('请排查差异：\n1. 确认[待补充:表名]的取数口径')
  let placeholderError = null
  try {
    await service.optimize('拼多多的GMV和去退数量，结果表和底表有差异，你查一下', {
      mode: 'llm',
      provider: 'mock-provider',
      model: 'mock-model'
    })
  } catch (error) {
    placeholderError = error
  }
  ok('模型输出含占位符时抛错（由 HTTP 端点降级为本地规则）',
    placeholderError && /占位符/.test(placeholderError.message) && /待补充/.test(placeholderError.message),
    placeholderError?.message)

  /* ---- 降级路径：HTTP 端点的 catch 分支给出本地 fallback ---- */
  const optimizeRoute = registeredFetchRoutes.find((r) => r.path.endsWith('/optimize'))
  streamHandler = async () => [
    { type: 'finish', reason: { kind: 'error', failure: { code: 'MISSING_CREDENTIAL', message: 'no API key' } } }
  ]
  const req = new Request('http://127.0.0.1/api/prompt-optimizer/optimize', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      text: '拼多多的GMV和去退数量，结果表和底表有差异，你查一下',
      settings: { mode: 'llm', provider: 'mock-provider', model: 'mock-model' }
    })
  })
  const res = await optimizeRoute.fetch(req)
  const payload = await res.json()
  ok('LLM 失败时端点返回 ok:false 且带本地 fallback',
    payload.ok === false && typeof payload.fallback === 'string' &&
      payload.fallback.startsWith('请排查拼多多') && !payload.fallback.includes('要求：'),
    { ok: payload.ok, error: payload.error, fallback: payload.fallback })

  console.log(`\n全部通过：${passed} 项断言 ✅`)
})().catch((e) => {
  console.error('冒烟测试失败 ❌', e)
  process.exit(1)
})
