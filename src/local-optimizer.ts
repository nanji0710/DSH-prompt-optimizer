/**
 * 本地正则规则优化引擎
 *
 * 零 Token、毫秒级、纯函数、无网络与 Node 依赖（浏览器半边直接复用本文件）。
 *
 * 规则定义与逐条触发条件/处理/示例见 `docs/local-optimization-rules.md`（规则手册 r3）。
 * 代码里的 `L0-xxx` / `L1-xxx` 注释与文档小节编号一一对应，**改规则必须同步文档**。
 */

import type { LocalRulesConfig, RoleItem } from './config'

/* ================================================================== *
 * 类型
 * ================================================================== */

export type TaskType =
  | 'code' // 写代码
  | 'doc' // 写文档 / 文案
  | 'translate' // 翻译
  | 'summarize' // 总结
  | 'qa' // 问答
  | 'brainstorm' // 头脑风暴
  | 'data' // 数据处理
  | 'general' // 通用（兜底）

export type OptimizeSkipReason = 'empty' | 'too-short' | 'already-structured' | 'no-rule-matched'

export interface OptimizeResult {
  /** 最终输出（输入非空时永远非空） */
  text: string
  /** `text !== input`，客户端据此提示「已符合规则」 */
  changed: boolean
  reason?: OptimizeSkipReason
  /** L1-001 判定结果 */
  task: TaskType
  /** 命中的规则 ID，按执行顺序 */
  applied: string[]
  /** 规则内部异常（仅调试用，不外泄给用户） */
  failed?: Array<{ id: string; error: unknown }>
}

interface Ctx {
  text: string
  cfg: LocalRulesConfig
  role: RoleItem
  applied: string[]
  failed: Array<{ id: string; error: unknown }>
  task: TaskType
  taskConfidence: 'high' | 'mid' | 'low'
  question: boolean
}

/* ================================================================== *
 * 3.3 代码围栏分段器 / 行内代码保护
 * ================================================================== */

const FENCE_LINE = /^[ \t]{0,3}(?:```|~~~)/

/** 把文本切成代码段与普通段；文本类规则只在 `code:false` 的段上执行。 */
function splitByFence(text: string): Array<{ code: boolean; value: string }> {
  const parts: Array<{ code: boolean; value: string }> = []
  let buf: string[] = []
  let inFence = false
  for (const line of text.split('\n')) {
    const isFenceLine = FENCE_LINE.test(line)
    if (isFenceLine && !inFence) {
      if (buf.length) parts.push({ code: false, value: buf.join('\n') })
      buf = [line]
      inFence = true
    } else if (isFenceLine && inFence) {
      buf.push(line)
      parts.push({ code: true, value: buf.join('\n') })
      buf = []
      inFence = false
    } else {
      buf.push(line)
    }
  }
  if (buf.length) parts.push({ code: inFence, value: buf.join('\n') })
  return parts
}

/** 只在非代码围栏段上跑 `fn`。 */
function mapNonCode(text: string, fn: (segment: string) => string): string {
  const parts = splitByFence(text)
  if (!parts.some((part) => part.code)) return fn(text)
  return parts.map((part) => (part.code ? part.value : fn(part.value))).join('\n')
}

/** 抽出行内代码（`` ` `` 包裹）换成占位符，规则跑完再还原。 */
function protectInlineCode(text: string): { text: string; restore: (s: string) => string } {
  const saved: string[] = []
  const masked = text.replace(/`[^`\n]*`/g, (m) => {
    saved.push(m)
    return `\u0000C${saved.length - 1}\u0000`
  })
  return {
    text: masked,
    restore: (s: string) => s.replace(/\u0000C(\d+)\u0000/g, (_, i: string) => saved[Number(i)] ?? '')
  }
}

/** 非代码段 + 行内代码保护，一次到位。 */
function mapProse(text: string, fn: (segment: string) => string): string {
  return mapNonCode(text, (segment) => {
    const { text: masked, restore } = protectInlineCode(segment)
    return restore(fn(masked))
  })
}

/* ================================================================== *
 * L0 清洗层
 * ================================================================== */

const trimLineEnds = (t: string): string => t.replace(/^[ \t\u3000]+|[ \t\u3000]+$/gm, '')

/** L0-002 隐形字符归一。 */
function normalizeInvisible(t: string): string {
  return mapNonCode(t, (s) =>
    s
      .replace(/[\u00A0\u2007\u202F]/g, ' ') // 不换行空格 → 普通空格
      .replace(/[\u200B-\u200D\uFEFF]/g, '') // 零宽空格/连接符/BOM → 删除
      .replace(/\u3000/g, ' ') // 全角空格 → 普通空格
  )
}

/** L0-005 重复标点折叠（含整行分隔线保护）。 */
function foldRepeatedPunct(t: string): string {
  return mapProse(t, (segment) => {
    const seps: string[] = []
    let out = segment.replace(/^(?:-{3,}|\*{3,}|_{3,})[ \t]*$/gm, (m) => {
      seps.push(m)
      return `\u0000S${seps.length - 1}\u0000`
    })
    out = out
      .replace(/(…){3,}/g, '……') // 三点以上省略号 → 标准六点
      .replace(/(—){3,}/g, '——') // 三个以上破折号 → 标准破折号
      .replace(/([。，、；：！？,.!?;:])\1+/g, '$1')
    return out.replace(/\u0000S(\d+)\u0000/g, (_, i: string) => seps[Number(i)] ?? '')
  })
}

const INTENSIFIERS = '非常|十分|特别|极其|相当|超级|格外'

/** L0-013 程度副词重复折叠（白名单，严禁泛化成 `(.)\\1`）。 */
function foldIntensifier(t: string): string {
  return mapProse(t, (s) =>
    s
      .replace(new RegExp(`(${INTENSIFIERS})\\s*(?:${INTENSIFIERS})`, 'g'), '$1')
      .replace(new RegExp(`(${INTENSIFIERS})\\1`, 'g'), '$1')
  )
}

/** L0-012 A 档：孤立填充词。 */
const FILLER = /(^|[\s，,。.；;：:!！?？、])(?:嗯+|啊+|呃+|哦+|唉+|额+|em+|hmm+|uh+)(?=[\s，,。.；;：:!！?？、]|$)/gim
/** L0-012 A 档补充：句尾填充词（无后续标点），如「帮我看看嗯」。 */
const FILLER_TAIL = /([\u3400-\u9fff])(?:嗯+|啊+|呃+|哦+|唉+|额+)$/

/** L0-012 语气词清除（A 档；B 档插入语有意不做，C 档永不删）。 */
function stripFillers(t: string): string {
  return mapProse(t, (segment) => {
    let out = segment
    let removed = false
    const a = out.replace(FILLER, '$1')
    if (a !== out) {
      out = a
      removed = true
    }
    const b = out.replace(FILLER_TAIL, '$1')
    if (b !== out) {
      out = b
      removed = true
    }
    if (!removed) return out
    // 后置清理：删完必然留下冗余空格与孤立标点
    return out
      .replace(/[ \t]{2,}/g, ' ')
      .replace(/([\u3400-\u9fff])[ \t]+(?=[\u3400-\u9fff])/g, '$1')
      .replace(/([，,、；;：:])\s*(?=[，,、；;：:])/g, '')
      .replace(/^[\s，,、；;：:]+/, '')
  })
}

/**
 * L0-010 句首客套清除。
 *
 * ★ 只作用于**整个输入的第一条非空行**：先把文本按 `\n` 切成首行与其余部分，
 * 只在首行上跑这些正则，再拼回。**不要给它们加 `m` 标志**——加了之后 `^`
 * 会在每一行行首匹配，等于失去「仅首行」约束（旧实现 `:35` 的 bug 之一）。
 */
const POLITE_HEAD_PATTERNS: RegExp[] = [
  /^(?:你好|您好|哈喽|嗨|在吗)[，,、!！。.~ \t]*/,
  /^请问(?:一下)?[，,、!！。.~ \t]*/,
  /^请你(?:一下)?[，,、!！。.~ \t]*/,
  /^(?:麻烦|劳驾|拜托)(?:你|您)?(?:一下)?[，,、!！。.~ \t]*/,
  /^(?:帮我|替我|给我)[，,、!！。.~ \t]*/,
  /^(?:我)?(?:想|要)?(?:请教|问一下|咨询)(?:一下)?[，,、!！。.~ \t]*/,
  /^(?:我想|我要|我打算)[，,、!！。.~ \t]*/,
  /^(?:Hello|Hi|Hey)[,!.\s]+/i,
  /^(?:Could|Would|Can)\s+you\s+(?:please\s+)?/i,
  /^Please\s+/i,
  /^(?:I\s+want\s+you\s+to|I'?d\s+like\s+you\s+to)\s+/i
]

/** 把文本切成「首行 / 其余（含换行）」——只作用于首个非空行时用它。 */
function splitFirstLine(text: string): { first: string; rest: string } {
  const cut = text.indexOf('\n')
  return cut === -1 ? { first: text, rest: '' } : { first: text.slice(0, cut), rest: text.slice(cut) }
}

/**
 * ★ 长度守卫：删除后整体剩余 < 4 字则回滚（`"你好，在吗"` 原样保留）。
 *
 * 计数**只算非空白字符**——`"帮我  写   代码"` 删掉"帮我"后剩 `"写 代码"`，
 * 按码点数 4 会被判为"够长"而删掉，但用户实际只想清理多余空格。
 * 手册 L0-010 的 `"在吗，问个事"` 剩 3 字回滚，用的也是这个口径。
 */
const HEAD_MIN_REMAIN = 4

function remainLength(s: string): number {
  return [...s.replace(/[ \t\r\n\u3000]/g, '')].length
}

function stripPoliteHead(text: string): string {
  const { first, rest } = splitFirstLine(text)
  for (const re of POLITE_HEAD_PATTERNS) {
    const m = first.match(re)
    if (!m || m[0] === '') continue
    const candidate = first.slice(m[0].length)
    if (remainLength(`${candidate}${rest}`) < HEAD_MIN_REMAIN) return text
    return candidate + rest
  }
  return text
}

/** L0-014 自我指涉前缀删除（`(?!的)` 守卫：`我认为的` 是定语，不能删）。 */
const SELF_REFERENCE = /^(?:我觉得|我认为|我感觉|我猜|我想说|个人认为|私以为)(?!的)[，,：: \t]*/

function stripSelfReference(text: string): string {
  const { first, rest } = splitFirstLine(text)
  const m = first.match(SELF_REFERENCE)
  if (!m || m[0] === '') return text
  const candidate = first.slice(m[0].length)
  // ★ 必须把 `rest` 拼回去——早期版本只返回 `candidate`，会吃掉首行之后的所有内容
  if ([...`${candidate}${rest}`.trim()].length < HEAD_MIN_REMAIN) return text
  return candidate + rest
}

/**
 * L0-011 句尾客套清除。
 *
 * ★ 关键：分隔符必须是**必需的**（`(?:^|[，,、 \t])`），不能写成 `[，,、\s]*`——
 * 后者会把 `"写一段感谢信，结尾用谢谢"` 里的"谢谢"当成句尾客套删掉。
 */
const POLITE_TAIL = /(?:^|[，,、 \t])(?:谢谢|多谢|感谢|拜托了|辛苦了|麻烦你了|thanks|thank you|please)[。.!！~ \t]*$/i

const QUOTE_CHARS = /["'“”‘’「」『』`]/

function stripPoliteTail(text: string): string {
  const m = text.match(POLITE_TAIL)
  if (!m || m[0] === '') return text
  const start = m.index ?? 0
  const before = text.slice(0, start).replace(/[ \t]+$/, '')
  if (QUOTE_CHARS.test(before.slice(-1))) return text // 守卫 2：引号内的"谢谢"不动
  if ([...before.trim()].length < 4) return text // 守卫 1：长度兜底
  return before
}

/**
 * L0-016 首尾客套收敛循环。
 *
 * L0-010/L0-011/L0-014 每条单次只删一块（可回滚的安全设计），叠了三层客套时
 * 必须循环到不动点；上限 4 轮是安全上界，保证守卫写错时表现为"少删一点"而不是卡死。
 */
function stripTopBottomPoliteness(c: Ctx): void {
  let cur = c.text
  for (let round = 0; round < 4; round += 1) {
    const before = cur

    const head = stripPoliteHead(cur)
    if (head !== cur) {
      cur = head
      record(c, 'L0-010')
    }
    const self = stripSelfReference(cur)
    if (self !== cur) {
      cur = self
      record(c, 'L0-014')
    }
    const tail = stripPoliteTail(cur)
    if (tail !== cur) {
      cur = tail
      record(c, 'L0-011')
    }
    cur = trimLineEnds(cur)

    if (cur === before) break // 不动点，收敛退出
  }
  if (cur !== c.text) {
    c.text = cur
    record(c, 'L0-016')
  }
}

/* ================================================================== *
 * L1 结构层
 * ================================================================== */

const TASK_PRIORITY: TaskType[] = [
  'translate',
  'summarize',
  'code',
  'data',
  'doc',
  'brainstorm',
  'qa',
  'general'
]

interface TaskRule {
  task: TaskType
  confidence: 'high' | 'mid'
  re: RegExp
}

/** L1-001 关键词表（★英文一律带 `\\b`；"写"必须与编程宾语共现才算 code）。 */
const TASK_RULES: TaskRule[] = [
  { task: 'translate', confidence: 'high', re: /(?:翻译|译成|译为|英译中|中译英|转成英文|转成中文)/ },
  { task: 'translate', confidence: 'high', re: /\b(?:translate|translation)\b/i },
  { task: 'summarize', confidence: 'high', re: /(?:总结|概括|摘要|归纳|提炼|精简|压缩成|划重点)/ },
  { task: 'summarize', confidence: 'high', re: /\b(?:summari[sz]e|summary|tl;?dr|digest)\b/i },
  {
    task: 'code',
    confidence: 'high',
    re: /(?:写|实现|编写|开发|重构|修复|优化)(?:一个|个|段)?(?:函数|方法|类|组件|接口|脚本|代码|程序|工具|算法|页面)/
  },
  {
    task: 'code',
    confidence: 'high',
    re: /\b(?:implement|refactor|debug|fix|write\s+code|function|component|api|bug|unit\s+test)\b/i
  },
  {
    task: 'code',
    confidence: 'mid',
    re: /(?:\b(?:python|node|golang|rust|kotlin|swift|typescript|javascript|react|vue|angular|svelte)\b|\b(?:docker|kubernetes|k8s|nginx|mysql|postgres|redis|mongodb|kafka|elasticsearch)\b)/i
  },
  { task: 'code', confidence: 'mid', re: /(?:报错|异常|堆栈|编译不过|跑不起来|死循环|内存泄漏|性能瓶颈)/ },
  { task: 'data', confidence: 'mid', re: /(?:清洗|去重|统计|聚合|透视|算一下|分析一下|同比|环比|留存|转化率)/ },
  { task: 'data', confidence: 'mid', re: /\b(?:excel|csv|sql|pandas|dataframe|group\s*by|join)\b/i },
  {
    task: 'doc',
    confidence: 'high',
    re: /(?:写|生成|输出|起草|拟)(?:一份|个|篇)?(?:文档|大纲|方案|PRD|周报|汇报|报告|邮件|纪要|说明书|总结文档)/
  },
  { task: 'doc', confidence: 'mid', re: /\b(?:write|draft|outline|proposal|readme)\b/i },
  { task: 'doc', confidence: 'mid', re: /(?:文案|稿子|宣传语|slogan)/i },
  { task: 'brainstorm', confidence: 'mid', re: /(?:想几个|给(?:我)?(?:几个|一些)?(?:点子|名字|创意|方案|标题|思路)|头脑风暴|列几个)/ },
  { task: 'brainstorm', confidence: 'mid', re: /\b(?:brainstorm|ideas?|name\s+ideas?)\b/i },
  { task: 'qa', confidence: 'mid', re: /^\s*(?:为什么|为啥|怎么|如何|是什么|什么是|有哪些|哪个|哪几个|能否|可不可以)/ },
  { task: 'qa', confidence: 'mid', re: /^\s*(?:what|why|how|which|when|is\s+it|can\s+i|should\s+i)\b/i }
]

const QUESTION_HEAD = /^\s*(?:为什么|为啥|怎么|如何|是什么|什么是|有哪些|哪个|哪几个|能否|可不可以)/
const QUESTION_HEAD_EN = /^\s*(?:what|why|how|which|when|is\s+it|can\s+i|should\s+i)\b/i

function detectTask(text: string): {
  task: TaskType
  confidence: 'high' | 'mid' | 'low'
  matched: string[]
  question: boolean
} {
  const hits = new Map<TaskType, { confidence: 'high' | 'mid'; matched: string[] }>()
  for (const rule of TASK_RULES) {
    const m = rule.re.exec(text)
    if (!m) continue
    const hit = hits.get(rule.task)
    if (hit) {
      hit.matched.push(m[0])
      if (rule.confidence === 'high') hit.confidence = 'high'
    } else {
      hits.set(rule.task, { confidence: rule.confidence, matched: [m[0]] })
    }
  }
  let task: TaskType = 'general'
  let confidence: 'high' | 'mid' | 'low' = 'low'
  let matched: string[] = []
  for (const candidate of TASK_PRIORITY) {
    const hit = hits.get(candidate)
    if (!hit) continue
    task = candidate
    confidence = hit.confidence
    matched = hit.matched
    break
  }
  const question = task !== 'qa' && (QUESTION_HEAD.test(text) || QUESTION_HEAD_EN.test(text))
  return { task, confidence, matched, question }
}

/** L1-002 阿拉伯序号归一（★三条正则必须分开写，否则 `1.5 小时` 会被拆坏）。 */
function normalizeOrderedList(t: string): string {
  return mapProse(t, (s) =>
    s
      .replace(/^[ \t]*(\d{1,3})[、．][ \t]*/gm, '$1. ')
      // ★ 必须把原有空白一起吃掉（`[ \t]+` 在捕获组里而不是用前瞻）：
      // 文档写的 `\.(?=[ \t]+\S)` 会把 `3. 最后重启` 改成 `3.  最后重启`
      // （替换文本自带一个空格，原空格仍在），再跑一遍还会继续加空格 → 违反 I1 幂等。
      .replace(/^[ \t]*(\d{1,3})\.[ \t]+(?=\S)/gm, '$1. ')
      .replace(/^[ \t]*[（(](\d{1,3})[）)][ \t]*/gm, '$1. ')
  )
}

/** L1-003 项目符号归一（标记后必须紧跟空白，`-5`、`**粗体**`、`--flag` 天然免疫）。 */
function normalizeBullets(t: string): string {
  return mapProse(t, (s) => s.replace(/^[ \t]*[-—–*●▪◆•·※+][ \t]+(?=\S)/gm, '- '))
}

/** L1-004 单行顿号并列拆分；不满足阈值返回 null（表示不动这一行）。 */
function splitEnumerationLine(line: string): string | null {
  const items = line.split('、')
  if (items.length < 4) return null
  if (line.length < 12) return null
  if (items.some((it) => it.trim().length === 0 || it.trim().length > 30)) return null

  const first = items[0]
  const m = first.match(/^(.*?)(支持|包含|包括|覆盖|分为|有|是|需要|要求)/)
  const lead = m ? m[0] : null
  const head = lead ? items[0].slice(lead.length) : items[0]
  const bullets = [head, ...items.slice(1)].map((it) => `- ${it.trim()}`)
  return lead ? `${lead}：\n${bullets.join('\n')}` : bullets.join('\n')
}

function splitEnumeration(t: string): string {
  return mapNonCode(t, (segment) =>
    segment
      .split('\n')
      .map((line) => {
        if (!line.includes('、')) return line
        const { text: masked, restore } = protectInlineCode(line)
        const next = splitEnumerationLine(masked)
        return next === null ? line : restore(next)
      })
      .join('\n')
  )
}

/** L1-006 长句自动分段（仅长度 ≥ 60 的行；`(?=[^\\n])` 保证幂等）。 */
function splitLongLines(t: string): string {
  return mapProse(t, (segment) =>
    segment
      .split('\n')
      .map((line) => ([...line].length >= 60 ? line.replace(/([。；;])[ \t]*(?=[^\n])/g, '$1\n') : line))
      .join('\n')
      .replace(/\n{3,}/g, '\n\n')
  )
}

const SECTION_KEYWORDS = [
  '需求',
  '功能',
  '要求',
  '需要',
  '问题',
  '背景',
  '约束',
  '交付',
  '注意',
  '目标',
  '场景',
  '输入',
  '输出'
]

/**
 * L1-007 小节标题识别。
 *
 * 三条守卫缺一不可：空标题跳过（内容 < 4 字）、已是标题的行不碰、
 * **同一关键词只转一次**——用「文中已存在 `### 关键词`」判定，这样第二次
 * 运行（幂等）时不会再动第二处 `注意：`。
 */
function extractSectionHeadings(t: string): string {
  return mapProse(t, (segment) => {
    let out = segment
    for (const kw of SECTION_KEYWORDS) {
      if (new RegExp(`^#{1,6}[ \\t]*${kw}[ \\t]*$`, 'm').test(out)) continue
      const re = new RegExp(`^[ \\t]*${kw}[：:][ \\t]*`, 'gm')
      const m = re.exec(out)
      if (!m) continue
      const after = out.slice(m.index + m[0].length)
      const lines = after.split('\n')
      const content = lines[0].trim() || (lines[1] ?? '').trim()
      // 守卫 1：内容 ≥ 3 个非空白字符。阈值取 3（不是 4）——`"注意：如下"`
      // 是 2 字应当拦住，而附录 B #30 的 `"注意：第一条"` 是 3 字必须放行，
      // 4 会让 #30 整条规则不生效（文档两处要求冲突，此处取两者都能满足的 3）。
      if ([...content].length < 3) continue
      out = `${out.slice(0, m.index)}\n### ${kw}\n\n${after}`
    }
    return out.replace(/^[\n \t]+/, '')
  })
}

/** L2-002 逐 task 的输出格式约束（逐字，勿改）。 */
const FORMAT_BY_TASK: Partial<Record<TaskType, string>> = {
  code: '输出完整可运行的代码块，标注语言，关键函数加注释；不要解释代码本身，除非我问。',
  doc: '用 Markdown 输出，分章节，每章不超过 300 字；结论先行。',
  translate: '只输出译文，不要解释；保留原文的标点和段落结构。',
  summarize: '输出 3-5 条要点，每条不超过 50 字；最后给一句整体结论。',
  qa: '先给一句话结论，再展开原因；分点说明，不超过 5 点。',
  brainstorm: '输出 5-8 个选项，每个选项给一句话说明优缺点。',
  data: '输出表格 + 关键结论；数字保留两位小数。'
}

const QUESTION_PREFIX = '先给一句话结论，再展开原因。'

/** §8.1 最终输出骨架。 */
const SKELETON = (body: string, background: string, requirement: string, format: string): string =>
  `【任务】
${body}

【背景】
${background || '无'}

【要求】
${requirement || '[待补充:具体约束、范围、禁止项]'}

【输出格式】
${format || '[待补充:期望的格式、长度、风格]'}`

/** L1-008 骨架重组（四条触发条件全满足才动手）。 */
function applySkeleton(text: string, c: Ctx, context: ContextInfo): string {
  if ((text.match(/\n/g) ?? []).length >= 3) return text // 1. 用户已分段
  if ([...text.trim()].length < 30) return text // 2. 短输入不套
  if (c.taskConfidence === 'low') return text // 3. 认不出任务类型
  if (/【(?:任务|背景|要求|输出格式)】/.test(text)) return text // 4. 已有骨架
  if (/^#{1,3}[ \t]+\S/m.test(text)) return text // 4. 已有标题

  const requirement =
    c.cfg.appendConstraints && c.cfg.constraintsText.trim() ? c.cfg.constraintsText.trim() : ''
  const format = c.task === 'general' ? '' : FORMAT_BY_TASK[c.task] ?? ''
  return SKELETON(text.trim(), context.background, requirement, format)
}

/* ================================================================== *
 * L2 约束层
 * ================================================================== */

interface ContextInfo {
  background: string
  labels: string[]
}

const CONTEXT_GROUPS: Array<{ label: string; items: string[] }> = [
  {
    label: '技术栈',
    items: [
      'React', 'Vue', 'Angular', 'Svelte', 'Next.js', 'Nuxt', 'TypeScript', 'JavaScript', 'Node',
      'Java', 'Go', 'Golang', 'Python', 'Rust', 'C++', 'C#', 'PHP', 'Kotlin', 'Swift', 'MySQL',
      'PostgreSQL', 'MongoDB', 'Redis', 'Elasticsearch', 'Kafka', 'Docker', 'K8s', 'Kubernetes',
      'Nginx', 'Flutter', 'Android', 'iOS', '微信小程序'
    ]
  },
  {
    label: '业务场景',
    items: [
      '电商', '金融', '支付', '社交', '教育', '医疗', '物流', '后台管理', '小程序', 'APP', '网站',
      'SaaS', '中台', 'BI'
    ]
  },
  {
    label: '数据规模',
    items: ['百万级', '千万级', '亿级', '日活', 'DAU', 'MAU', 'QPS', 'TPS', '并发', '峰值', 'TB', 'PB']
  },
  {
    label: '交付形态',
    items: ['接口', 'SDK', 'CLI', '脚本', '组件库', '微服务', '单体', 'Serverless']
  }
]

/** 英文/缩写词要求词边界，避免 `Go` 命中 `Google`、`api` 命中 `rapid`。 */
function hitWord(text: string, word: string): boolean {
  if (/^[A-Za-z0-9+#.\- ]+$/.test(word)) {
    const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    return new RegExp(`(^|[^A-Za-z0-9_])${escaped}(?![A-Za-z0-9_])`, 'i').test(text)
  }
  return text.includes(word)
}

/** L2-001 上下文抽取（只增加信息，不搬移原文）。 */
function extractContext(text: string): ContextInfo {
  const groups = CONTEXT_GROUPS.map((group) => ({
    label: group.label,
    items: group.items.filter((item) => hitWord(text, item))
  })).filter((group) => group.items.length > 0)

  const total = groups.reduce((n, group) => n + group.items.length, 0)
  let background = ''
  if (total === 1 || total === 2) {
    background = groups.flatMap((group) => group.items).join('、')
  } else if (total >= 3) {
    background = groups.map((group) => `${group.label}：${group.items.join('、')}`).join('\n')
  }
  return { background, labels: groups.map((group) => group.label) }
}

/** 用户是否已经自己指定了输出格式（命中即不再追加，避免自相矛盾）。 */
const FORMAT_SPEC =
  /(输出格式|格式要求|返回格式|用\s*markdown|markdown\s*格式|json|yaml|xml|表格|列表形式|分点|要点|字数|不超过\s*\d+\s*字|代码块|以.{0,6}开头|风格)/i

/** L2-002 输出格式补全。 */
function appendOutputFormat(text: string, task: TaskType, question: boolean): string {
  if (FORMAT_SPEC.test(text)) return text
  if (task === 'general' && !question) return text

  const parts: string[] = []
  if (question && task !== 'qa') parts.push(QUESTION_PREFIX)
  const spec = FORMAT_BY_TASK[task]
  if (spec && !parts.includes(spec)) parts.push(spec)
  if (parts.length === 0) return text

  const block = `【输出格式】\n${parts.join('')}`
  if (text.includes(block)) return text // 幂等守卫
  return `${text.trimEnd()}\n\n${block}`
}

/* ================================================================== *
 * L3 角色层
 * ================================================================== */

/** L3-001 角色注入（★必须把 rolePrompt 全文注入，只写角色名等于没做角色化）。 */
function injectRole(text: string, role: RoleItem): string {
  const header = `角色：${role.name}`
  if (text.startsWith(header)) return text // 幂等守卫
  const prompt = (role.rolePrompt || '').trim()
  if (!prompt) return `${header}\n${text}`
  if (prompt.includes('{{user_prompt}}')) {
    return `${header}\n【角色设定】\n${prompt.replace(/\{\{user_prompt\}\}/g, text)}`
  }
  return `${header}\n【角色设定】\n${prompt}\n\n${text}`
}

/* ================================================================== *
 * 透传判定（§9）
 * ================================================================== */

function looksStructured(text: string): boolean {
  // ★ `角色设定` 必须在内：否则 L3-001 注入的产物再跑一遍会被 L1-004/L2-002
  // 当成普通正文重写（rolePrompt 里的顿号被拆成列表、还会重复追加输出格式），
  // 直接违反 I1 幂等。L3 的输出本身就是结构化提示词，理应透传。
  if (/【(?:任务|背景|要求|输出格式|角色设定)】/.test(text)) return true
  if (/^#{1,3}[ \t]+\S/m.test(text)) return true
  if (/^\s*(?:You are|Act as)\b/im.test(text)) return true

  const parts = splitByFence(text)
  if (parts.some((part) => part.code)) {
    const total = text.length
    const codeLength = parts
      .filter((part) => part.code)
      .reduce((n, part) => n + part.value.length, 0)
    if (total > 0 && (total - codeLength) / total < 0.3) return true // 主要在贴代码
  }
  return false
}

/* ================================================================== *
 * 执行器与主流水线
 * ================================================================== */

function record(c: Ctx, id: string): void {
  if (!c.applied.includes(id)) c.applied.push(id)
}

/** 单条规则执行器：抛错即跳过，保证「失败即降级」。 */
function rule(c: Ctx, id: string, fn: (t: string) => string): void {
  if (c.applied.includes(id)) return
  try {
    const next = fn(c.text)
    if (typeof next === 'string' && next !== c.text) {
      c.text = next
      c.applied.push(id) // 记在 applied 尾部即天然按执行顺序
    }
  } catch (error) {
    c.failed.push({ id, error }) // ★ 不要静默吞掉：无效正则会表现为「规则莫名不生效」
  }
}

/** L0-015 长度兜底：清洗后几乎为空（< 3 码点）才短路。 */
const MIN_LENGTH = 3
/** 超长输入截断上限（码点）。 */
const MAX_LENGTH = 8000

/**
 * 本地规则优化。
 *
 * @param text 原始输入
 * @param config 本地规则配置（`LocalRulesConfig`）
 * @param currentRole 当前生效角色
 */
export function localOptimize(
  text: string,
  config: LocalRulesConfig,
  currentRole: RoleItem
): OptimizeResult {
  const input = text ?? ''
  if (!input.trim()) {
    return { text: input, changed: false, reason: 'empty', task: 'general', applied: [] }
  }

  const cfg: LocalRulesConfig = config
  const c: Ctx = {
    text: input,
    cfg,
    role: currentRole,
    applied: [],
    failed: [],
    task: 'general',
    taskConfidence: 'low',
    question: false
  }

  /* ---------------- L0 ---------------- */
  if (cfg.cleanWhitespace) {
    rule(c, 'L0-002', normalizeInvisible)
    rule(c, 'L0-001', trimLineEnds)
    rule(c, 'L0-003', (t) => mapNonCode(t, (s) => s.replace(/[ \t]{2,}/g, ' ')))
    rule(c, 'L0-004', (t) => t.replace(/\n{3,}/g, '\n\n'))
  }
  if (cfg.filterPoliteWords) {
    rule(c, 'L0-005', foldRepeatedPunct)
    rule(c, 'L0-013', foldIntensifier)
    rule(c, 'L0-012', stripFillers)
    // L0-016 内部循环跑 L0-010 → L0-014 → L0-011
    try {
      stripTopBottomPoliteness(c)
    } catch (error) {
      c.failed.push({ id: 'L0-016', error })
    }
  }

  /* ---------------- L0-015 长度兜底 ---------------- */
  const chars = Array.from(c.text)
  if (chars.length < MIN_LENGTH) {
    return { text: input, changed: false, reason: 'too-short', task: 'general', applied: c.applied }
  }
  if (chars.length > MAX_LENGTH) {
    c.text = `${chars.slice(0, MAX_LENGTH).join('')}\n\n[...内容过长已截断]`
  }

  /* ---------------- 结构化判定（透传） ---------------- */
  if (looksStructured(c.text)) {
    return { text: input, changed: false, reason: 'already-structured', task: 'general', applied: c.applied }
  }

  /* -------- L1 前的两个分析步骤（不改文本，只往 ctx 里存结果） -------- */
  const detected = detectTask(c.text) // L1-001
  c.task = detected.task
  c.taskConfidence = detected.confidence
  c.question = detected.question
  const context = extractContext(c.text) // L2-001 ★必须在这里跑，不能等 L1-008 才跑

  /* ---------------- L1 ---------------- */
  if (cfg.normalizeList) {
    rule(c, 'L1-002', normalizeOrderedList)
    rule(c, 'L1-003', normalizeBullets)
    rule(c, 'L1-004', splitEnumeration)
  }
  if (cfg.autoSplitParagraph) rule(c, 'L1-006', splitLongLines)
  if (cfg.splitSections) {
    rule(c, 'L1-007', extractSectionHeadings)
    rule(c, 'L1-008', (t) => applySkeleton(t, c, context))
  }

  /* ---------------- L2 ---------------- */
  rule(c, 'L2-002', (t) => appendOutputFormat(t, c.task, c.question))
  if (cfg.appendConstraints && cfg.constraintsText.trim()) {
    rule(c, 'L2-003', (t) => {
      const block = cfg.constraintsText.trim()
      return t.includes(block) ? t : `${t.trimEnd()}\n\n${block}`
    })
  }

  /* ---------------- L3 ---------------- */
  if (cfg.enableRoleOptimization && c.role) rule(c, 'L3-001', (t) => injectRole(t, c.role))

  const out = c.text.trim()
  return {
    text: out,
    changed: out !== input,
    reason: out === input ? 'no-rule-matched' : undefined,
    task: c.task,
    applied: c.applied,
    failed: c.failed.length > 0 ? c.failed : undefined
  }
}

/** 只要文本结果的便捷包装（宿主与客户端多数场景用这个）。 */
export function localOptimizeText(
  text: string,
  config: LocalRulesConfig,
  currentRole: RoleItem
): string {
  return localOptimize(text, config, currentRole).text
}
