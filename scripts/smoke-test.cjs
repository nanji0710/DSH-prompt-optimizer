/**
 * 冒烟测试：mock DSH 宿主（cordis / ctx），验证插件核心逻辑
 * 运行：node scripts/smoke-test.cjs
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
const { defaultConfig, PRESET_ROLES } = require(path.join(dist, 'config.js'))

// 2) 构造 mock ctx（模拟 Cordis ctx.inject / ctx.provide / ctx.get）
const config = JSON.parse(JSON.stringify(defaultConfig))
let llmCalls = 0
let llmShouldFail = false
const registered = {}
let injectArgs = null

const llmMock = {
  chat: async (payload) => {
    llmCalls++
    if (llmShouldFail) throw new Error('mock llm error')
    return { content: '```\nLLM优化结果\n```' }
  }
}

const ctx = {
  // Cordis 延迟注入：记录参数并立即执行回调
  inject: (services, cb) => {
    injectArgs = services
    cb({ config: ctx.config })
  },
  // 服务注册
  provide: (name, impl) => { registered[name] = impl },
  // 可选服务动态探测
  get: (name) => (name === 'llm' ? llmMock : undefined),
  // config 服务
  config: {
    get: () => config,
    defaults: () => {}
  }
}

// 3) 执行插件 apply
apply(ctx)

let passed = 0
const ok = (name, cond) => {
  assert.ok(cond, name)
  console.log('  PASS  ' + name)
  passed++
}

;(async () => {
  ok('ctx.inject 被调用且声明了 config 依赖', Array.isArray(injectArgs) && injectArgs.includes('config'))
  const service = registered.promptOptimizer
  ok('服务 promptOptimizer 已通过 provide 注册', typeof service?.optimize === 'function')
  ok('getAllRoles 返回内置 6 个角色', service.getAllRoles().length === 6)
  ok('默认角色为通用角色', service.getCurrentRole().id === 'general')

  // 4) 本地引擎：客套词过滤 + 空内容保护
  const r1 = await service.optimize('麻烦你帮我写一个登录页面，谢谢')
  ok('本地优化过滤了句首客套词', !r1.includes('麻烦你'))
  ok('本地优化过滤了句尾感谢词', !r1.includes('谢谢'))
  const rEmpty = await service.optimize('   ')
  ok('空内容返回空字符串', rEmpty === '')

  // 5) 角色注入
  config.localRules.enableRoleOptimization = true
  config.localRules.currentRoleId = 'frontend-dev'
  const r2 = await service.optimize('帮我写个按钮组件')
  ok('角色注入生效（前端开发工程师）', r2.startsWith('角色：前端开发工程师'))
  config.localRules.enableRoleOptimization = false

  // 6) 本地引擎直接调用 - 列表序号归一化
  config.localRules.enableRoleOptimization = false
  const r3 = service.localOptimize('（1）第一项\n（2）第二项\n* 第三项')
  ok('列表序号归一化为 1./2. 与 -', r3.includes('1. 第一项') && r3.includes('2. 第二项') && r3.includes('- 第三项'))

  // 7) LLM 模式：未配置模型时回退本地
  config.optimizeMode = 'llm'
  config.llmModel = ''
  await service.optimize('请问怎么实现防抖')
  ok('未配置模型时不调用 LLM', llmCalls === 0)

  // 8) LLM 模式正常调用 + 代码块剥离
  config.llmModel = 'mock-model'
  const r4 = await service.optimize('请帮我优化这段需求描述，包括实现方案与细节要求')
  ok('LLM 模式调用了 llm.chat', llmCalls === 1)
  ok('LLM 结果剥离了代码块包裹', r4 === 'LLM优化结果')

  // 9) LLM 失败自动降级本地引擎
  llmShouldFail = true
  const r5 = await service.optimize('麻烦帮我排查一下报错，谢谢')
  ok('LLM 失败时降级为本地优化', typeof r5 === 'string' && !r5.includes('麻烦'))
  llmShouldFail = false

  // 10) 自定义角色可被查找
  config.localRules.customRoles = [
    { id: 'custom-1', name: '测试工程师', description: 'd', rolePrompt: '你是测试工程师' }
  ]
  config.localRules.currentRoleId = 'custom-1'
  ok('自定义角色可被 getCurrentRole 查找', service.getCurrentRole().name === '测试工程师')

  console.log(`\n全部通过：${passed} 项断言 ✅`)
})().catch((e) => {
  console.error('冒烟测试失败 ❌', e)
  process.exit(1)
})
