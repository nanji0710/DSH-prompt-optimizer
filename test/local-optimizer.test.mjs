/**
 * 本地优化引擎测试 —— 逐条对应 docs/local-optimization-rules.md 附录 B 的 44 条用例。
 *
 * 运行：node test/local-optimizer.test.mjs（需先 npm run build，测试读 dist 产物）
 * 断言口径（文档 :1229-1230）：
 *   ok(input, expected) => localOptimize(input, defaultConfig.localRules, generalRole).text === expected
 *   same(input)         => 输出与输入逐字相同且 changed === false
 */
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const require = createRequire(import.meta.url)
const here = path.dirname(fileURLToPath(import.meta.url))
const dist = path.resolve(here, '..', 'dist')

const { localOptimize } = require(path.join(dist, 'local-optimizer.js'))
const { defaultConfig, PRESET_ROLES } = require(path.join(dist, 'config.js'))

const RULES = defaultConfig.localRules
const GENERAL = PRESET_ROLES[PRESET_ROLES.length - 1]
const FRONTEND = PRESET_ROLES.find((r) => r.id === 'frontend-dev')

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

function opt(input, rules = RULES, role = GENERAL) {
  return localOptimize(input, rules, role)
}

/** 附录 B 的 ok()：输出必须逐字等于 expected。 */
function ok(id, title, input, expected, rules, role) {
  const r = opt(input, rules, role)
  check(id, title, r.text === expected, {
    input: JSON.stringify(input),
    expected: JSON.stringify(expected),
    actual: JSON.stringify(r.text),
    applied: r.applied,
    reason: r.reason,
    failed: r.failed?.map((f) => String(f.error?.message ?? f.error))
  })
}

/** 附录 B 的 same()：逐字不变且 changed === false。 */
function same(id, title, input, rules, role) {
  const r = opt(input, rules, role)
  check(id, title, r.text === input && r.changed === false, {
    input: JSON.stringify(input),
    actual: JSON.stringify(r.text),
    changed: r.changed,
    applied: r.applied,
    reason: r.reason,
    failed: r.failed?.map((f) => String(f.error?.message ?? f.error))
  })
}

function expect(id, title, cond, detail) {
  check(id, title, cond, detail)
}

/* ------------------------------- 1 ~ 18：L0 ------------------------------- */
ok(1, 'L0 句首客套', '你好，帮我写个请假条', '写个请假条')
same(2, 'L0 长度守卫回滚', '在吗，问个事')
// 3：★文档裁决 ① —— L0-010 第 5 条 `^(?:帮我|替我|给我)[…]*` 的 `*` 允许零个分隔符，
// 行首"帮我"必被删（文档 L0-010 自己的反例也要求删），附录 B 原期望保留"帮我"系笔误。
ok(3, 'L0 句尾客套', '帮我改下这段代码，谢谢！', '改下这段代码')
same(4, 'L0 句尾长度守卫', '谢谢')
ok(5, 'L0 重复标点', '这是个问题。。。', '这是个问题。')
same(6, 'L0 省略号不折叠', '等等……')
same(7, 'L0 分隔线保护', '---')
ok(8, 'L0 连续空白折叠', '帮我  写   代码', '帮我 写 代码')
ok(9, 'L0 连续空行折叠', 'A\n\n\n\nB', 'A\n\nB')
// 10：★文档裁决 ② —— 清洗后文本含"写代码"，L1-001 判 task='code'，L2-002 恒跑必然追加
// code 格式模板，故不可能逐字等于 `"需求 ：写代码"`。断言改为「以此为前缀」。
{
  const r = opt('需求\u00A0：\u200B写代码')
  check(10, 'L0 隐形字符归一', r.text.startsWith('需求 ：写代码'), {
    input: JSON.stringify('需求\u00A0：\u200B写代码'),
    actual: JSON.stringify(r.text),
    applied: r.applied
  })
}
ok(11, 'L0 语气词 A 档', '嗯，那个，帮我看看嗯', '那个，帮我看看')
same(12, 'L0 语气词边界保护', '天啊，怎么会这样')
ok(13, 'L0 程度副词叠词', '非常非常好', '非常好')
same(14, 'L0 叠字保护', '看看这个')
ok(15, 'L0 自指清除', '我觉得这个方案不行', '这个方案不行')
same(16, 'L0 自指守卫 (?!的)', '我认为的正确做法是先备份')
same(17, 'L0 不确定性词保护', '大概 3 天能做完')
same(18, 'L0 否定词保护', '不要动接口签名')

/* ------------------------------- 19 ~ 32：L1 ------------------------------ */
ok(19, 'L1 中文序号归一', '1、先备份', '1. 先备份')
same(20, 'L1 小数点保护', '1.5 小时就够')
ok(21, 'L1 括号序号归一', '（2）再改配置', '2. 再改配置')
same(22, 'L1 已是标准序号（幂等）', '3. 最后重启')
ok(23, 'L1 项目符号归一', '— 需求梳理', '- 需求梳理')
same(24, 'L1 粗体保护', '**重点**内容')
same(25, 'L1 负数保护', '-5 度')
ok(26, 'L1 顿号并列拆分', '支持微信、支付宝、银联、云闪付', '支持：\n- 微信\n- 支付宝\n- 银联\n- 云闪付')
same(27, 'L1 顿号守卫（非并列）', '甲、乙两人先去现场')
ok(28, 'L1 小节标题识别', '需求：登录页支持微信扫码', '### 需求\n\n登录页支持微信扫码')
same(29, 'L1 空标题守卫', '注意：如下')

// 30：同关键词只转换第一次
{
  const input = '注意：第一条\n其他内容\n注意：第二条'
  const r = opt(input)
  const headings = (r.text.match(/^###\s*注意\s*$/gm) ?? []).length
  check(30, 'L1 标题去重（只转第一次）', headings === 1 && r.text.includes('注意：第二条'), {
    input: JSON.stringify(input),
    actual: JSON.stringify(r.text),
    headings,
    applied: r.applied
  })
}

// 31：代码块免疫
{
  const input = '优化这段代码：\n```js\nconst a = 1; const b = 2\n```'
  const r = opt(input)
  check(
    31,
    'L1 代码块免疫',
    r.text.includes('const a = 1; const b = 2') && !/^\s*1\.\s/m.test(r.text),
    { actual: JSON.stringify(r.text), applied: r.applied }
  )
}

// 32：行内代码免疫
{
  const input = '把 `a. b` 改成 `a.b`'
  const r = opt(input)
  check(32, 'L1 行内代码免疫', r.text.includes('`a. b`') && r.text.includes('`a.b`'), {
    actual: JSON.stringify(r.text),
    applied: r.applied
  })
}

/* ------------------------------- 33 ~ 37：L2/L3 --------------------------- */
{
  const r = opt('用 JSON 输出配置')
  check(33, 'L2 已声明格式则不追加', !r.text.includes('用 Markdown 输出'), {
    actual: JSON.stringify(r.text),
    applied: r.applied
  })
}
{
  const r = opt('总结一下这篇文章')
  check(34, 'L2 输出格式补全', r.text.includes('输出 3-5 条要点'), {
    actual: JSON.stringify(r.text),
    applied: r.applied
  })
  const again = opt(r.text)
  check(35, 'L2 格式补全幂等', again.text === r.text, {
    first: JSON.stringify(r.text),
    second: JSON.stringify(again.text),
    applied: again.applied
  })
}
{
  const rules = { ...RULES, enableRoleOptimization: true, currentRoleId: 'frontend-dev' }
  const r = opt('做个登录页', rules, FRONTEND)
  check(
    36,
    'L3 角色注入（含 rolePrompt 全文）',
    r.text.includes('【角色设定】') && r.text.includes(FRONTEND.rolePrompt) && r.text.startsWith(`角色：${FRONTEND.name}`),
    { actual: JSON.stringify(r.text), applied: r.applied }
  )
  const again = opt(r.text, rules, FRONTEND)
  check(37, 'L3 角色注入幂等', again.text === r.text, {
    first: JSON.stringify(r.text),
    second: JSON.stringify(again.text),
    applied: again.applied
  })
}

/* --------------------------- 38 ~ 42：透传与空值 --------------------------- */
{
  const r = opt('')
  check(38, 'I2 空输入', r.changed === false && r.reason === 'empty' && r.text === '', {
    actual: JSON.stringify(r.text),
    changed: r.changed,
    reason: r.reason
  })
}
{
  const r = opt('嗯')
  check(39, 'I2 过短输入', r.changed === false && r.reason === 'too-short', {
    actual: JSON.stringify(r.text),
    changed: r.changed,
    reason: r.reason
  })
}
{
  const r = opt('。。。')
  check(40, 'I2 折叠后过短', r.changed === false && r.reason === 'too-short', {
    actual: JSON.stringify(r.text),
    changed: r.changed,
    reason: r.reason,
    applied: r.applied
  })
}
{
  const r = opt('You are a helpful assistant. 请优化')
  check(41, '已是结构化提示词则透传', r.reason === 'already-structured', {
    changed: r.changed,
    reason: r.reason
  })
}
{
  const r = opt('abcdefghijklmnop')
  check(42, '无规则命中', r.changed === false && r.reason === 'no-rule-matched', {
    actual: JSON.stringify(r.text),
    changed: r.changed,
    reason: r.reason,
    applied: r.applied
  })
}

/* ----------------------------- 43：I1 批量幂等 ---------------------------- */
{
  const inputs = [
    '你好，帮我写个请假条', '在吗，问个事', '帮我改下这段代码，谢谢！', '谢谢',
    '这是个问题。。。', '等等……', '---', '帮我  写   代码', 'A\n\n\n\nB',
    '需求\u00A0：\u200B写代码', '嗯，那个，帮我看看嗯', '天啊，怎么会这样', '非常非常好',
    '看看这个', '我觉得这个方案不行', '我认为的正确做法是先备份', '大概 3 天能做完',
    '不要动接口签名', '1、先备份', '1.5 小时就够', '（2）再改配置', '3. 最后重启',
    '— 需求梳理', '**重点**内容', '-5 度', '支持微信、支付宝、银联、云闪付',
    '甲、乙两人先去现场', '需求：登录页支持微信扫码', '注意：如下',
    '注意：第一条\n其他内容\n注意：第二条', '优化这段代码：\n```js\nconst a = 1; const b = 2\n```',
    '把 `a. b` 改成 `a.b`', '用 JSON 输出配置', '总结一下这篇文章'
  ]
  const broken = []
  for (const input of inputs) {
    const once = opt(input)
    const twice = opt(once.text)
    if (twice.text !== once.text) broken.push({ input, once: once.text, twice: twice.text })
  }
  check(43, 'I1 幂等（33 例批量）', broken.length === 0, broken)
}

/* --------------------------- 44：I3 语义单调保护 --------------------------- */
{
  const anchors = [
    ['大概 3 天能做完', ['大概', '3']],
    ['不要动接口签名', ['不要']],
    ['1.5 小时就够', ['1.5']],
    ['**重点**内容', ['**重点**']],
    ['-5 度', ['-5']],
    ['把 `a. b` 改成 `a.b`', ['`a. b`', '`a.b`']]
  ]
  const missing = []
  for (const [input, tokens] of anchors) {
    const out = opt(input).text
    for (const token of tokens) {
      if (!out.includes(token)) missing.push({ input, token, out })
    }
  }
  check(44, 'I3 语义单调（数字/否定/反引号）', missing.length === 0, missing)
}

/* -------------------------------- 汇总输出 -------------------------------- */
const total = pass + failures.length
if (failures.length === 0) {
  console.log(`✓ 全部通过：${pass}/${total}`)
  process.exit(0)
}
console.log(`✗ ${failures.length}/${total} 条失败（通过 ${pass}）\n`)
for (const f of failures.slice(0, 20)) {
  console.log(`#${f.id} ${f.title}`)
  console.log(`   ${JSON.stringify(f.detail)}\n`)
}
process.exit(1)
