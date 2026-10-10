/**
 * 本地优化引擎测试 —— 对应 docs/optimization-directions.md §六 的 6 条验收标准。
 *
 * 运行：`node test/local-optimizer.test.mjs`（需先 `npm run build`，测试读 dist 产物）
 *
 * ★ v0.3.0：整套用例已随引擎重写。旧版 44 条测的是被取代的
 * L0/L1/L2/L3 四层体系（客套清除、结构改写、约束追加），
 * 那些规则已按规格 §三 明确砍掉。
 */
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const require = createRequire(import.meta.url)
const here = path.dirname(fileURLToPath(import.meta.url))
const dist = path.resolve(here, '..', 'dist')

const { localOptimize } = require(path.join(dist, 'local-optimizer.js'))
const { defaultConfig, PRESET_ROLES } = require(path.join(dist, 'config.js'))
const { containsPlaceholder, findPlaceholder } = require(path.join(dist, 'prompt.js'))

const RULES = defaultConfig.localRules
const GENERAL = PRESET_ROLES[PRESET_ROLES.length - 1]
const ANALYST = PRESET_ROLES.find((r) => r.id === 'data-analyst')

/* ------------------------------ 迷你测试框架 ------------------------------ */
let pass = 0
const failures = []

function check(id, title, cond, detail) {
  if (cond) {
    pass++
    return
  }
  failures.push({ id, title, detail })
}

const opt = (input, rules = RULES, role = GENERAL) => localOptimize(input, rules, role)

/* ---------------------------------------------------------------------------
 * §六 验收标准 1：输出里 grep 不到 待补充 / TODO / xxx / <占位符>
 * ------------------------------------------------------------------------ */

const PLACEHOLDER_INPUTS = [
  '拼多多的GMV，去退数量，成本。京东自营的去退数量，成本。结果表和底表有一点差异，你查一下',
  '帮我写一个数据同步脚本',
  '为什么我的接口会超时',
  '写个爬虫',
  '总结一下这个季度的工作',
  '帮我看下这个报错',
  '设计一个订单表结构',
  '把这个文档翻译成英文'
]

for (const [index, input] of PLACEHOLDER_INPUTS.entries()) {
  const r = opt(input)
  check(
    `V1-${index + 1}`,
    `验收1：输出零占位符（${input.slice(0, 12)}…）`,
    !containsPlaceholder(r.text),
    { input, actual: r.text, hit: findPlaceholder(r.text) }
  )
}

/* ---------------------------------------------------------------------------
 * §六 验收标准 2：100 字以内的原文，优化后不超过 300 字
 * ------------------------------------------------------------------------ */

for (const [index, input] of PLACEHOLDER_INPUTS.entries()) {
  if ([...input].length > 100) continue
  const r = opt(input)
  check(
    `V2-${index + 1}`,
    `验收2：≤100 字原文 → 输出 ≤300 字（${input.slice(0, 12)}…）`,
    [...r.text].length <= 300,
    { input, length: [...r.text].length, actual: r.text }
  )
}

/* ---------------------------------------------------------------------------
 * §六 验收标准 3：原文已经很清晰时，输出接近原文（不强行加结构）
 * ------------------------------------------------------------------------ */

const CLEAR_INPUTS = [
  '请排查结果表与底表的差异，只看拼多多，最近7天，输出表格',
  '需求：登录页支持微信扫码',
  '【任务】修复登录超时\n【要求】不要改动接口签名'
]

for (const [index, input] of CLEAR_INPUTS.entries()) {
  const r = opt(input)
  const grew = [...r.text].length / [...input].length
  check(
    `V3-${index + 1}`,
    `验收3：清晰原文不强行加结构（${input.slice(0, 12)}…）`,
    grew <= 1.6 && !/五段式/.test(r.text),
    { input, actual: r.text, ratio: Number(grew.toFixed(2)), task: r.task }
  )
}

/* ---------------------------------------------------------------------------
 * §六 验收标准 4：数据对账类必须含「定位环节 + 验证方法 + 修正建议」三要素
 * ------------------------------------------------------------------------ */

const RECONCILE_INPUT =
  '拼多多的GMV，去退数量，成本。京东自营的去退数量，成本。结果表和底表有一点差异，你查一下'

const rec = opt(RECONCILE_INPUT)
check('V4-1', '验收4：对账类判定为 reconcile 场景', rec.task === 'reconcile', { task: rec.task })
check(
  'V4-2',
  '验收4：含「定位环节」',
  /取数口径|计算逻辑|关联聚合|调度时效/.test(rec.text),
  { actual: rec.text }
)
check('V4-3', '验收4：含「验证方法」（SQL 或检查方法）', /SQL|检查方法/.test(rec.text), {
  actual: rec.text
})
check('V4-4', '验收4：含「修正建议」', /修正建议/.test(rec.text), { actual: rec.text })

// ★ 规格 §1.1 的核心病灶：旧版只贴角色标签、不做实体抽取。
check('V4-5', '验收4：抽出平台实体（拼多多 / 京东自营）', /拼多多/.test(rec.text) && /京东自营/.test(rec.text), {
  actual: rec.text
})
check('V4-6', '验收4：抽出指标并关联到平台', /拼多多（[^）]*GMV[^）]*）/.test(rec.text), { actual: rec.text })
check('V4-7', '验收4：不做"加前缀"式优化（不以角色行开头）', !rec.text.startsWith('角色：'), { actual: rec.text.slice(0, 40) })

/* ---------------------------------------------------------------------------
 * §六 验收标准 5：默认不注入角色；选了才加，且只加 1 行
 * ------------------------------------------------------------------------ */

const roleOff = opt('写个请假条', RULES, ANALYST)
check(
  'V5-1',
  '验收5：默认不注入角色（即使选中了数据分析师）',
  !roleOff.text.includes('数据分析师'),
  { actual: roleOff.text }
)

const roleOn = opt('写个请假条', { ...RULES, enableRoleOptimization: true }, ANALYST)
const roleOnLines = roleOn.text.split('\n')
check(
  'V5-2',
  '验收5：开启后只加 1 行角色',
  roleOnLines[0] === '你是一名数据分析师，回答时先给结论再给依据。',
  { actual: roleOn.text, firstLine: roleOnLines[0] }
)
check('V5-3', '验收5：通用角色的 rolePrompt 为空（选它等于不注入）', GENERAL.rolePrompt === '', {
  rolePrompt: GENERAL.rolePrompt
})

/* ---------------------------------------------------------------------------
 * §六 验收标准 6：本地引擎响应 < 50ms；降级路径可用
 * ------------------------------------------------------------------------ */

const BIG_INPUT = '请帮我写一个数据同步脚本，'.repeat(300) + '结果表与底表有差异，你查一下'
const t0 = process.hrtime.bigint()
const ITERATIONS = 20
for (let i = 0; i < ITERATIONS; i += 1) opt(BIG_INPUT)
const avgMs = Number(process.hrtime.bigint() - t0) / 1e6 / ITERATIONS
check('V6-1', `验收6：${[...BIG_INPUT].length} 字输入平均 ${avgMs.toFixed(2)}ms < 50ms`, avgMs < 50, {
  avgMs
})

/* ---------------------------------------------------------------------------
 * 质量不变量：I1 幂等 / I2 非空 / 场景路由正确
 * ------------------------------------------------------------------------ */

const IDEMPOTENT_INPUTS = [
  ...PLACEHOLDER_INPUTS,
  ...CLEAR_INPUTS,
  RECONCILE_INPUT,
  '你好，帮我写个请假条',
  '写个排序',
  '把这个文档翻译成英文',
  '帮我看看这段代码为什么会报错',
  'You are a helpful assistant. 请优化'
]

for (const [index, input] of IDEMPOTENT_INPUTS.entries()) {
  const once = opt(input)
  const twice = opt(once.text)
  check(`I1-${index + 1}`, `I1 幂等：二次优化不再变化（${input.slice(0, 12)}…）`, once.text === twice.text, {
    input,
    once: once.text,
    twice: twice.text
  })
  check(`I2-${index + 1}`, `I2 非空：输出非空（${input.slice(0, 12)}…）`, once.text.trim() !== '', {
    input,
    actual: once.text
  })
}

/* ---------------------------------------------------------------------------
 * 场景路由（规格 Step 1-A / 1-C）
 * ------------------------------------------------------------------------ */

const TASK_CASES = [
  ['why-timeout', '为什么我的接口会超时', 'qa'],
  ['how-to', '如何设计一个高并发订单系统', 'qa'],
  ['reconcile-diff', '结果表和底表的差异帮我查一下', 'reconcile'],
  ['reconcile-metric', 'GMV 口径对不上，排查一下', 'reconcile'],
  ['code-bug', '这段代码报错了帮我看看怎么改', 'code'],
  ['code-feature', '帮我实现一个导出 Excel 的功能接口', 'code'],
  ['doc-report', '写一份这个季度的项目汇报文档', 'doc'],
  ['doc-weekly', '这个周报帮我整理成方案', 'doc']
]

for (const [id, input, expected] of TASK_CASES) {
  const r = opt(input)
  check(`T-${id}`, `场景识别：${input.slice(0, 14)}… → ${expected}`, r.task === expected, {
    input,
    expected,
    actual: r.task,
    text: r.text.slice(0, 60)
  })
}

/* ---------------------------------------------------------------------------
 * 边界与透传（规格 §二「缺信息不问」+ §六 验收标准 3）
 * ------------------------------------------------------------------------ */

const empty = opt('')
check('B-empty', '空输入 → reason=empty 且输出为空', empty.reason === 'empty' && empty.text === '', {
  reason: empty.reason,
  text: empty.text
})

const short = opt('嗯')
check('B-short', '过短输入 → reason=too-short 且原样返回', short.reason === 'too-short' && short.text === '嗯' && short.changed === false, {
  reason: short.reason,
  text: short.text,
  changed: short.changed
})

const punctOnly = opt('。。。')
check(
  'B-punct',
  '纯标点 → 不套模板（无信息可抽取）',
  punctOnly.changed === false && punctOnly.text === '。。。',
  { text: punctOnly.text, changed: punctOnly.changed, reason: punctOnly.reason }
)

// 客套清除：叠三层也要收敛，且不能删成空壳
const polite = opt('你好，麻烦帮我看看这个 bug，谢谢！')
check(
  'B-polite',
  '首尾客套收敛清除且保留实义（"看看这个 bug"）',
  /看看这个 bug/.test(polite.text) && !/你好|麻烦|谢谢/.test(polite.text),
  { actual: polite.text }
)

// ★ 规格 §二「零占位符」：绝不能出现"缺失信息用占位符标出"
check(
  'B-noplaceholder',
  '规则文本里不含"用占位符标出"的旧指令',
  !/用\s*\[待补充/.test(JSON.stringify(RULES)),
  { rules: JSON.stringify(RULES) }
)

// 开关生效性
const noExtract = opt(RECONCILE_INPUT, { ...RULES, extractEntities: false })
check(
  'B-switch-extract',
  '关闭「信息抽取」后不再抽平台/指标',
  !/拼多多（/.test(noExtract.text),
  { actual: noExtract.text.slice(0, 80) }
)

const noTemplate = opt(RECONCILE_INPUT, { ...RULES, applyTemplate: false })
check(
  'B-switch-template',
  '关闭「紧凑重组」后退化为兜底模板',
  !/请排查以下数据差异/.test(noTemplate.text) && /直接回答/.test(noTemplate.text),
  { actual: noTemplate.text.slice(0, 80) }
)

/* ---------------------------------------------------------------------------
 * 系统提示词（规格 §四）
 * ------------------------------------------------------------------------ */

const { buildSystemPrompt, detectLanguage, stripDecoration } = require(path.join(dist, 'prompt.js'))

const zhSystem = buildSystemPrompt('zh')
check('P-1', '中文 system prompt 禁止占位符', /绝对不要出现/.test(zhSystem), {})
check('P-2', '中文 system prompt 限制字数 ≤ 原文 3 倍', /3\s*倍/.test(zhSystem), {})
check('P-3', '中文 system prompt 要求原文清晰时返回原文', /直接返回原文/.test(zhSystem), {})
check('P-4', '中文 system prompt 要求可执行指令、以动词开头', /可执行的指令/.test(zhSystem), {})
check('P-5', '中文 system prompt 不再有"扩张才是重点"的旧指令', !/扩张才是重点/.test(zhSystem), {})
check('P-6', '中文 system prompt 不再示范 [待补充] 占位符', !/\[待补充:语言/.test(zhSystem), {})

const enSystem = buildSystemPrompt('en')
check('P-7', '英文 system prompt 禁止占位符', /Never emit markers/.test(enSystem), {})
check('P-8', '英文 system prompt 限制 3x', /3x/.test(enSystem), {})
check('P-9', '英文 system prompt 不再示范 [TODO: language', !/\[TODO: language/.test(enSystem), {})

const withRole = buildSystemPrompt('zh', '你是一名数据分析师，回答时先给结论再给依据。')
check('P-10', '角色以「回答视角」注入且只有一行', withRole.includes('# 回答视角') && withRole.includes('先给结论再给依据'), {})
check('P-11', '空 rolePrompt 不产生角色块', !buildSystemPrompt('zh', '').includes('# 回答视角'), {})

check('P-12', '语言识别：中文 → zh', detectLanguage('帮我写个脚本') === 'zh', {})
check('P-13', '语言识别：英文 → en', detectLanguage('write me a scraper') === 'en', {})

check('P-14', 'stripDecoration 去掉整体代码围栏', stripDecoration('```\n请排查差异\n```') === '请排查差异', {
  actual: stripDecoration('```\n请排查差异\n```')
})
check('P-15', 'stripDecoration 去掉「优化后：」前缀', stripDecoration('优化后：请排查差异') === '请排查差异', {
  actual: stripDecoration('优化后：请排查差异')
})

check('P-16', 'containsPlaceholder 命中各种占位符形态', [
  '[待补充:表名]',
  '【待补充】',
  'TODO',
  '[TODO: table]',
  '<fill here>',
  'xxx'
].every((s) => containsPlaceholder(s)), {})
check('P-17', 'containsPlaceholder 不误伤正常代码', [
  'Promise<T>',
  '<div>hello</div>',
  'Array<string>',
  '请排查差异'
].every((s) => !containsPlaceholder(s)), {})

/* ------------------------------- 结果汇总 ------------------------------- */
const total = pass + failures.length
if (failures.length === 0) {
  console.log(`✓ 全部通过：${pass}/${total}`)
  process.exit(0)
}

console.error(`✗ 失败 ${failures.length}/${total}\n`)
for (const item of failures.slice(0, 20)) {
  console.error(`[${item.id}] ${item.title}`)
  for (const [key, value] of Object.entries(item.detail ?? {})) {
    console.error(`    ${key}: ${typeof value === 'string' ? value : JSON.stringify(value)}`)
  }
  console.error('')
}
if (failures.length > 20) console.error(`… 其余 ${failures.length - 20} 条省略`)
process.exit(1)
