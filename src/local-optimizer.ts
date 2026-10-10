/**
 * 本地提示词优化引擎（v0.3.0 两级流水线）
 *
 * 依据 `docs/optimization-directions.md` 重设计。核心变化：
 *
 * | | v0.2（旧） | v0.3（本文件） |
 * |---|---|---|
 * | 结构 | L0 清洗 → L1 结构 → L2 约束 → L3 角色（4 级 24 条规则） | Step 1 信息抽取 → Step 2 紧凑重组（2 级） |
 * | 手法 | 贴标签 + 套五段式模板 | 抽出实体/动作/场景后**只套一个**紧凑模板 |
 * | 客套清除 | 独立开关层（L0-010/011/014/016） | 仅兜底模板内部做一次 |
 * | 约束追加 | L2-003 通用约束块 | 只抽原文里**真实存在**的时间/范围/输出要求 |
 * | 角色 | 注入多行长模板 | 默认不注入；注入时压到 1 行 |
 *
 * 三条硬约束（对应规格 §二、§六）：
 * 1. **零占位符**：绝不输出 `[待补充]` / `TODO` / `xxx` / `<…>`；缺失的信息宁可不写。
 * 2. **篇幅克制**：要求条数按原文长度分档（1/2/3 条，见 `requirementLimit`），
 *    输出 ≤ 原文 × 3（对账类另有 300 字下限，见 `budgetOf`）。
 * 3. **不给标签**：不写「角色：」「## 任务目标」这类前缀，只保留用户自己的动宾结构。
 *
 * ★ v0.3.1 瘦身：v0.3.0 的实测问题是短诉求被固定要求撑爆——`写个爬虫`（4 字）
 * 输出 80 字（20 倍）、`总结一下这份周报`（8 字）输出 69 字（8.6 倍）。对照 LLM
 * 侧规则（规格 §4.1 规则 2「短诉求短输出」/ 规则 4「删掉本来就会做的事」）收敛。
 */

import type { LocalRulesConfig, RoleItem } from './config'

/** 场景类型：对应规格 Step 1-C 的四个场景 + 兜底。 */
export type TaskType = 'reconcile' | 'code' | 'doc' | 'qa' | 'general'

export type OptimizeSkipReason = 'empty' | 'too-short' | 'already-structured' | 'no-rule-matched'

export interface OptimizeResult {
  /** 优化后的文本 */
  text: string
  /** 是否发生了实质变化 */
  changed: boolean
  /** 未优化的原因（仅当 changed === false） */
  reason?: OptimizeSkipReason
  /** 识别出的场景 */
  task: TaskType
  /** 实际生效的步骤 id，便于调试与测试断言 */
  applied: string[]
  /** 出错的步骤（仅调试用，正常情况下为 undefined） */
  failed?: Array<{ id: string; error: unknown }>
}

/** 低于此长度不处理（"嗯"、"。。。" 这类没有优化价值）。 */
const MIN_LENGTH = 3

/** 短输入的篇幅下限。
 *
 * 严格按「原文 × 3」会让任何模板对超短输入都超标（33 字的对账诉求上限
 * 只有 99 字，连一句"每个原因给一条可验证的 SQL"都放不下）。规格 §六 验收
 * 标准 2 给的硬指标是「100 字以内的原文 → 输出不超过 300 字」，
 * 即 300 是 100 字以内输入的实际上限，故取 `max(原文 × 3, 300)`。
 */
const MIN_BUDGET = 300

/** 要求条数的长度分档：短诉求不该被三条固定要求撑爆。
 *
 * 规格 §4.1 规则 2 明写「短诉求短输出，不要因为模板有五个小节就全都填满」。
 * 实测 `写个爬虫`（4 字）加三条要求后是 80 字（20 倍），用户直接反馈"有点多
 * 有点冗余"，故按原文长度决定给几条：
 *   - < 30 字：1 条（只补最关键的一句）
 *   - < 80 字：2 条
 *   - ≥ 80 字：3 条（信息足够，值得完整规格）
 */
function requirementLimit(original: string): number {
  const length = [...original].length
  if (length < 30) return 1
  if (length < 80) return 2
  return 3
}

// ---------------------------------------------------------------------------
// Step 1-B 实体抽取词表
// ---------------------------------------------------------------------------

/** 平台 / 公司 */
const PLATFORMS = [
  '拼多多', '京东自营', '京东', '淘宝', '天猫', '抖音', '快手', '唯品会',
  '得物', '小红书', '亚马逊', '美团', '饿了么'
]

/** 业务模块 / 指标 */
const METRICS = [
  'GMV', '去退数量', '去退金额', '客单价', '转化率', '退款率', '退货率',
  '曝光量', '点击率', '订单量', '成本', '退款', '退货', '库存', '利润'
]

/** 数据表 / 报表 */
const TABLES = [
  '结果表', '底表', '明细表', '汇总表', '日报', '周报', '月报', '对账表'
]

/** 技术栈 */
const STACKS = [
  'TypeScript', 'JavaScript', 'React', 'Vue', 'Node', 'Python', 'Java', 'Go',
  'MySQL', 'PostgreSQL', 'Redis', 'SQL', 'Excel', 'Pandas', 'Spark', 'Hive',
  'Flink', 'Docker', 'K8s', 'Nginx'
]

/** 拉丁词加词边界，避免 `Go` 命中 `Google`；中文直接 includes。 */
function hitWord(text: string, word: string): boolean {
  if (/^[\x00-\x7F]+$/.test(word)) {
    const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    return new RegExp(`(^|[^A-Za-z0-9_])${escaped}(?![A-Za-z0-9_])`, 'i').test(text)
  }
  return text.includes(word)
}

/**
 * 按出现顺序抽出词表里命中的项；同一项只出现一次。
 *
 * ★ 长词优先：`京东自营` 与 `京东` 同时在词表里，若两者都收下，切段时
 * 同位置的短词会拿到空片段（`京东自营` 抢走了段首），平台名就会被渲染成
 * 较短的 `京东`。因此按长度降序匹配，已被更长命中词**包含**的短词直接丢弃。
 */
function collect(text: string, words: string[]): string[] {
  const lower = text.toLowerCase()
  const accepted: string[] = []
  const found: Array<{ word: string; at: number }> = []

  for (const word of [...words].sort((a, b) => b.length - a.length)) {
    if (!hitWord(text, word)) continue
    if (accepted.some((longer) => longer.toLowerCase().includes(word.toLowerCase()))) continue
    accepted.push(word)
    const at = lower.indexOf(word.toLowerCase())
    found.push({ word, at: at === -1 ? Number.MAX_SAFE_INTEGER : at })
  }

  found.sort((a, b) => a.at - b.at)
  return found.map((item) => item.word)
}

/**
 * 把指标关联到它前面最近的平台上，渲染成 `拼多多（GMV、成本）和京东自营（去退数量）`。
 *
 * 做法：按平台出现位置切段，每段内抽指标。这是规格 §4.3 期望输出的形状
 * （`涉及拼多多（GMV、去退数量、成本）和京东自营（去退数量、成本）`）。
 */
function associateMetrics(text: string, platforms: string[], metrics: string[]): string {
  const lower = text.toLowerCase()
  const marks = platforms
    .map((name) => ({ name, at: lower.indexOf(name.toLowerCase()) }))
    .filter((mark) => mark.at !== -1)
    .sort((a, b) => a.at - b.at)

  if (marks.length === 0) return metrics.join('、')

  const grouped: Array<{ name: string; metrics: string[] }> = []
  for (let i = 0; i < marks.length; i += 1) {
    const from = marks[i].at
    const to = i + 1 < marks.length ? marks[i + 1].at : text.length
    const slice = text.slice(from, to)
    const owned = metrics.filter((metric) => hitWord(slice, metric))
    if (owned.length > 0) grouped.push({ name: marks[i].name, metrics: owned })
  }

  if (grouped.length === 0) return metrics.join('、')
  return grouped.map((group) => `${group.name}（${group.metrics.join('、')}）`).join('和')
}

// ---------------------------------------------------------------------------
// Step 1-A 动作识别
// ---------------------------------------------------------------------------

/** 关键词 → 抽取到的动作（规格 Step 1-A 逐条对应）。 */
const ACTION_RULES: Array<{ re: RegExp; verb: string }> = [
  { re: /排查|查一下|查下|查查|看看|看一下|核对|对一下|对账|找一下|定位|查一查/, verb: '排查并定位问题' },
  { re: /总结|概括|归纳/, verb: '总结要点' },
  { re: /翻译|译成|译为/, verb: '翻译' },
  { re: /为什么|怎么回事|啥原因|咋回事|什么原因/, verb: '解释原因' },
  { re: /修改|改一下|改下|改成|优化|重构/, verb: '修改并给出新版本' },
  { re: /生成|写个|写一个|写一段|撰写|帮我写|写一/, verb: '产出' }
]

function detectAction(text: string): string {
  for (const rule of ACTION_RULES) {
    if (rule.re.test(text)) return rule.verb
  }
  return ''
}

// ---------------------------------------------------------------------------
// Step 1-C 场景识别
// ---------------------------------------------------------------------------

const SCENE_RULES: Array<{ task: TaskType; re: RegExp }> = [
  { task: 'reconcile', re: /差异|对不上|不一致|对不平|多出|少了|偏差|口径|对账|结果表|底表/g },
  { task: 'code', re: /报错|异常|崩溃|bug|功能|接口|函数|代码|脚本|组件|部署|性能|超时|重构|爬虫|排序|算法|正则/g },
  { task: 'doc', re: /方案|PRD|周报|日报|汇报|文档|报告|文案|提纲/g },
  { task: 'qa', re: /为什么|怎么|如何|是什么|区别|原理|原因/g }
]

/** 疑问句首：这类输入问的是"为什么"，不该被关键字计数判成开发任务。 */
const QUESTION_HEAD = /(?:^|[，,。；;]\s*)(?:为什么|为啥|怎么|怎样|如何|是什么|什么是|能否|可以吗|吗[??]?$)|怎么回事|啥原因|咋回事/

/**
 * 场景识别。
 *
 * 优先级不是简单按命中数取最大——`为什么我的接口会超时` 里 code 命中
 * 「接口」「超时」两词、qa 只命中「为什么」一词，但用户明显是在**提问**，
 * 套代码模板会答非所问。因此：对账（最specific）> 疑问句 > 命中数。
 */
function detectTask(text: string): { task: TaskType; confidence: 'high' | 'low' } {
  let best: { task: TaskType; hits: number } | null = null
  for (const rule of SCENE_RULES) {
    const hits = text.match(rule.re)?.length ?? 0
    if (hits === 0) continue
    if (!best || hits > best.hits) best = { task: rule.task, hits }
  }
  if (!best) return { task: 'general', confidence: 'low' }
  if (best.task !== 'reconcile' && QUESTION_HEAD.test(text)) {
    return { task: 'qa', confidence: 'high' }
  }
  return { task: best.task, confidence: best.hits >= 2 ? 'high' : 'low' }
}

// ---------------------------------------------------------------------------
// Step 1-D 约束抽取
// ---------------------------------------------------------------------------

interface Draft {
  task: TaskType
  platform: string[]
  metric: string[]
  table: string[]
  stack: string[]
  action: string
  time: string
  scope: string
  output: string
  /** 描述异常现象的那句话（用于"已知现象"） */
  anomaly: string
  /** 已做最小客套清除的原文 */
  core: string
}

const TIME_RE = /(最近\s*\d+\s*[天日月周]|\d{1,2}\s*月份?|本月|上月|上季度|本季度|Q[1-4]|\d{4}\s*年(?:度)?)/
const SCOPE_RE = /(只看[^，。；\n]{1,20}|仅看[^，。；\n]{1,20}|不包括[^，。；\n]{1,20}|不含[^，。；\n]{1,20}|排除[^，。；\n]{1,20})/
const OUTPUT_RE = /((?:用|以)?(?:表格|列表|JSON|Markdown|代码|文字)形式?[^，。；\n]{0,10}|\d+\s*字以内|不超过\s*\d+\s*字|分\s*\d+\s*点|要点式)/

/**
 * 抽出描述异常现象的那句话（用于模板 1 的「已知现象」）。
 *
 * 只取含异常关键词的**最短子句**：整段原文会把「只看拼多多」「最近7天」
 * 这类约束也塞进"已知现象"，而它们已经由 `constraintBullets` 单独成条了。
 */
function pickAnomaly(text: string): string {
  const clauses = text
    .split(/[。；;\n]/)
    .map((clause) => clause.trim())
    .filter(Boolean)
  const anomaly = /差异|对不上|不一致|多出|少了|偏差|不相符|相差|对不平/
  const hits = clauses.filter((clause) => anomaly.test(clause))
  if (hits.length > 0) {
    return hits.reduce((shortest, clause) => (clause.length < shortest.length ? clause : shortest))
  }
  return (clauses[0] ?? text).trim()
}

/** 最小客套清除：只处理句首问候/祈使与句尾致谢，带长度守卫。
 *
 * 句首可能叠多层（"你好，麻烦帮我写个请假条"），故循环至多 3 次到不动点。
 * 这不是旧版那个可配置的 L0 客套层——只是兜底模板内的一次性清理，
 * 出口始终有 `nonSpace(...) >= MIN_LENGTH` 守卫，永远不会删成空串。
 */
function stripPoliteness(text: string): string {
  const HEAD = /^(?:你好|您好|哈喽|嗨|在吗|请问|麻烦你|麻烦|劳驾|拜托|帮我|替我|给我|请你|我想|我要)[，,、!！。.~\s]*/
  const TAIL = /(?:^|[，,、 \t])(?:谢谢|多谢|感谢|拜托了|辛苦了|麻烦你了|thanks|thank you)[。.!！~\s]*$/i

  const nonSpace = (value: string): number => [...value.replace(/[ \t\r\n\u3000]/g, '')].length

  let result = text.trim()
  for (let round = 0; round < 3; round += 1) {
    const headMatch = result.match(HEAD)
    if (!headMatch) break
    if (nonSpace(result.slice(headMatch[0].length)) < MIN_LENGTH) break
    result = result.slice(headMatch[0].length).trimStart()
  }
  const tailMatch = result.match(TAIL)
  if (tailMatch && nonSpace(result.slice(0, tailMatch.index ?? 0)) >= MIN_LENGTH) {
    result = result.slice(0, tailMatch.index).trimEnd()
  }
  return result.trim()
}

// ---------------------------------------------------------------------------
// 原文是否"已经很清晰"（规格 §六 验收标准 3：清晰时不强行加结构）
// ---------------------------------------------------------------------------

const VERB_HEAD = /^(?:请|帮我|麻烦|写|生成|查|分析|设计|总结|翻译|列出|对比|优化|重构|实现|排查|核对|评估|梳理)/
const SECTION_WORDS = /【[^】]{1,8}】|(?:^|\n)\s*(?:需求|要求|约束|输出格式|背景|目标|注意|场景|输入|输出)[：:]/

function looksClear(text: string): boolean {
  if (SECTION_WORDS.test(text)) return true
  const lines = text.split('\n').filter((line) => line.trim() !== '')
  const hasList = /(?:^|\n)\s*(?:\d+[.、)]|[-*•])\s+\S/.test(text)
  if (lines.length >= 2 && hasList) return true
  if (VERB_HEAD.test(text.trim()) && [...text].length >= 60) return true
  // 用户自己已经写过约束（时间范围 / 只看范围 / 输出格式）且带动作动词时，
  // 也不要再套模板：把我们自己的「时间范围：…」「输出格式：…」补在他写过的
  // 那一条后面，正是规格 §二「篇幅克制」和 §三「砍掉 L2 通用约束补全」
  // 要消灭的行为。实测 `请排查结果表与底表的差异，只看拼多多，最近7天，输出表格`
  // （30 字）会被撑到 189 字（6.3 倍），直接违反 §六 验收标准 3。
  if (VERB_HEAD.test(text.trim()) && (TIME_RE.test(text) || SCOPE_RE.test(text) || OUTPUT_RE.test(text))) {
    return true
  }
  return false
}

// ---------------------------------------------------------------------------
// Step 2 紧凑重组（一句话 + 编号条目，与 LLM 侧输出同形）
// ---------------------------------------------------------------------------

/** ★ v0.3.3：条目的写法对齐 LLM 侧的实测输出。
 *
 * 旧版渲染是「字段标签块 + `要求：` + `- ` 列表」：
 *
 * ```
 * 请排查以下数据差异并定位原因：
 *
 * 涉及平台与指标：拼多多（GMV、去退数量）
 * 对比对象：结果表、底表
 * 已知现象：结果表和底表有差异
 *
 * 要求：
 * - 先给出差异出现在哪个环节（取数口径 / 计算逻辑 / 关联聚合 / 调度时效）
 * ```
 *
 * 同一句原文，LLM 侧（规格 §4.3 的期望形状）只有：
 *
 * ```
 * 请排查拼多多（GMV、去退数量）在结果表与底表间的差异：
 * 1. 定位出在取数口径、计算逻辑、关联聚合还是调度时效
 * ```
 *
 * 差别不在信息量，而在**载体**：实体/对比对象被 LLM 塞进同一句话，
 * 「已知现象」因为与那句话重复而被省略，`要求：`/`- ` 这两层样板也去掉了。
 * 用户反馈"本地优化规则还是没有参考 LLM 进行简化"，指的就是这一层。
 * 因此这里保留 §3.3 的抽取逻辑与 §六 的三要素，只把**渲染**换成 LLM 的形状。
 */

const RECONCILE_ITEMS = [
  '定位出在取数口径、计算逻辑、关联聚合还是调度时效',
  '给一条可验证的 SQL 或检查方法',
  '给修正建议，不要改线上数据'
]

const CODE_ITEMS = [
  '给可直接运行的完整代码，标注语言',
  '关键逻辑加注释，不要逐行解释',
  '有多种实现时给推荐方案和一句话理由'
]

const DOC_ITEMS = [
  'Markdown 格式，结论先行',
  '不超过 500 字',
  '缺失的背景按常规处理，不要反问'
]

const QA_ITEMS = [
  '先给一句话结论',
  '再分 2-3 点解释',
  '不确定的地方直接说不确定，不要编造'
]

/** 兜底模板只补一句：缺信息不要反问（规格 §二「缺信息不问」）。
 *
 * 措辞必须对「写请假条」和「排查超时」都成立，所以不能用「直接回答」——
 * 那是个问句专用的说法，挂在写作类诉求后面会变成病句。
 */
const GENERAL_ITEMS = ['按常规补齐缺失信息，不要反问']

/** 条目是否已经写在原文里了——幂等的关键防线。
 *
 * 二次优化时 `compose` 会再算一次条目，若不做这个判断就会把同一句要求
 * 追加第二遍（`写个爬虫：给可直接运行的完整代码…：给可直接运行的完整代码…`）。
 * 取前 6 个字符做探针而不是整句比对：用户把条目改写过一两个字时仍应视为已有。
 */
function alreadyHas(text: string, item: string): boolean {
  return text.includes([...item].slice(0, 6).join(''))
}

/** 按原文长度分档取条目，并剔除原文里已经写过的。
 *
 * ★ 幂等防线（实测踩过）：只做逐条剔除是不够的。`帮我看看这段代码为什么会报错`
 * 首轮只进 1 条（14 字 → 上限 1），产出 39 字；二次优化时分档按 39 字算成 2 条，
 * 于是第 1 条被剔除、第 2 条被追加，输出又变了。
 * 因此判据改为「只要原文里出现过**我们自己会补的任意一条**，就认定这段文本
 * 是本引擎的产物，一律不再追加」。探针取各条目前 6 字，措辞足够特异，不会
 * 误伤正常诉求。
 */
function itemsFor(bank: string[], original: string, core: string): string[] {
  if (bank.some((item) => alreadyHas(core, item))) return []
  return bank.slice(0, requirementLimit(original))
}

/** 约束条目同样要防重复追加（二次优化时 `时间范围：最近7天` 会被再抽一次）。 */
function constraintBullets(draft: Draft): string[] {
  const bullets: string[] = []
  if (draft.time) bullets.push(`时间范围：${draft.time}`)
  if (draft.scope) bullets.push(`范围限定：${draft.scope}`)
  if (draft.output) bullets.push(`输出形式：${draft.output}`)
  return bullets.filter((bullet) => !alreadyHas(draft.core, bullet))
}

/** 摘掉结尾标点，避免拼出「…。：」。 */
function trimTail(text: string): string {
  return text.replace(/[。．.!！?？;；,，、\s]+$/u, '')
}

/**
 * 渲染：单条目内联在同一句话里，多条目换行编号。
 *
 * 这正是 LLM 侧对这两类输入的实际写法——`把这段代码重构一下` →
 * `请重构这段代码，保持现有功能不变，并说明每处改动理由。`（内联）；
 * 对账类三条则换行编号。条目为空时原样返回，保证幂等。
 *
 * ★ 疑问句不能走内联：`为什么我的接口会超时：先给一句话结论。` 是病句
 * （疑问句后接冒号再接祈使句，中文不通）。LLM 侧对疑问句也是**独立成段**
 * 展开几个可能方向，故这里改为原文单独一行、要求另起一行。
 */
function renderItems(core: string, items: string[], question = false): string {
  if (items.length === 0) return core
  if (question) {
    const head = /[？！?!]$/.test(core) ? trimTail(core) + core.slice(-1) : `${trimTail(core)}。`
    return [head, ...items.map((item) => `${item}。`)].join('\n')
  }
  const head = trimTail(core)
  if (items.length === 1) return `${head}：${items[0]}。`
  return [head, ...items.map((item, index) => `${index + 1}. ${item}`)].join('\n').replace(/^(.*)$/m, '$1：')
}

/** 组装一个场景的完整输出。 */
function compose(draft: Draft, _config: LocalRulesConfig): { text: string; template: string } {
  const extra = constraintBullets(draft)
  const entities = associateMetrics(draft.core, draft.platform, draft.metric)
  const scope = draft.table.join('与')

  switch (draft.task) {
    case 'reconcile': {
      // 实体与对比对象内联进同一句话（规格 §4.3 的形状），不再用字段标签。
      const subject = entities && scope
        ? `${entities}在${scope}间`
        : scope
          ? `${scope}的`
          : entities
            ? `${entities}的`
            : '以下数据'
      const head = `请排查${subject}差异`
      // 「已知现象」与上面那句话通常完全重复（用户描述差异的那句话就是它），
      // 故只在它带来了新信息——一个具体数字——时才保留（规格 §1.3 WorkBuddy 的优点）。
      const note = /\d/.test(draft.anomaly) ? `。${draft.anomaly}。` : ''
      // ★ 对账三要素是**交付物本身**（规格 §六 验收标准 4 硬性要求：定位环节 +
      // 验证方法 + 修正建议），不是凑数的装饰，故不参与条数分档。
      const items = [...RECONCILE_ITEMS, ...extra].filter((item) => !alreadyHas(head, item))
      if (items.length === 0) return { template: 'T1', text: head + note }
      const lines = items.map((item, index) => `${index + 1}. ${item}`)
      return { template: 'T1', text: [`${head}${note || '：'}`, ...lines].join('\n') }
    }
    case 'code':
      return {
        template: 'T2',
        text: renderItems(draft.core, [...itemsFor(CODE_ITEMS, draft.core, draft.core), ...extra])
      }
    case 'doc':
      return {
        template: 'T3',
        text: renderItems(draft.core, [...itemsFor(DOC_ITEMS, draft.core, draft.core), ...extra])
      }
    case 'qa':
      return {
        template: 'T4',
        // 疑问句用「原文。」+ 换行的写法；非疑问句（`如何设计…` 这类祈使式问法
        // 里也有）仍走通用内联渲染。
        text: renderItems(
          draft.core,
          [...itemsFor(QA_ITEMS, draft.core, draft.core), ...extra],
          QUESTION_HEAD.test(draft.core)
        )
      }
    default:
      return {
        template: 'T5',
        text: renderItems(draft.core, itemsFor(GENERAL_ITEMS, draft.core, draft.core))
      }
  }
}

// ---------------------------------------------------------------------------
// 篇幅预算
// ---------------------------------------------------------------------------

/**
 * 输出篇幅上限。
 *
 * 严格按「原文 × 3」会让任何模板对超短输入都超标（"写个排序" 4 字 → 上限
 * 12 字，连一句要求都放不下），因此取 `max(原文 × 3, 300)`。
 * 规格 §六 验收标准 2 也只要求「100 字以内的原文 → 输出不超过 300 字」。
 */
function budgetOf(original: string): number {
  return Math.max([...original].length * 3, MIN_BUDGET)
}

/** 超预算时逐级降级：去掉约束条目 → 只留核心诉求 + 一行要求。 */
function fitBudget(draft: Draft, config: LocalRulesConfig): { text: string; template: string } {
  const budget = budgetOf(draft.core)

  const full = compose(draft, config)
  if ([...full.text].length <= budget) return full

  const lean = compose({ ...draft, time: '', scope: '', output: '' }, config)
  if ([...lean.text].length <= budget) return lean

  // 最后兜底：只保留"核心诉求 + 一句要求"，等价于模板 5
  return { template: 'T5', text: renderItems(draft.core, itemsFor(GENERAL_ITEMS, draft.core, draft.core)) }
}
// ---------------------------------------------------------------------------
// 角色注入（默认不注入；注入时只占 1 行）
// ---------------------------------------------------------------------------

/** 取角色提示词的第一行并压掉空白——保证只占 1 行。 */
function roleLine(role: RoleItem): string {
  return (role.rolePrompt || '').split('\n').map((line) => line.trim()).find(Boolean) ?? ''
}

function injectRole(text: string, role: RoleItem): string {
  const line = roleLine(role)
  if (!line) return text
  if (text.startsWith(line)) return text
  return `${line}\n${text}`
}

// ---------------------------------------------------------------------------
// 主入口
// ---------------------------------------------------------------------------

export function localOptimize(
  text: string,
  config: LocalRulesConfig,
  currentRole: RoleItem
): OptimizeResult {
  const input = typeof text === 'string' ? text : ''
  const applied: string[] = []
  const failed: Array<{ id: string; error: unknown }> = []
  const raw = input.trim()

  if (!raw) {
    return { text: '', changed: false, reason: 'empty', task: 'general', applied, failed }
  }
  if ([...raw].length < MIN_LENGTH) {
    return { text: raw, changed: false, reason: 'too-short', task: 'general', applied, failed }
  }
  // 纯标点/纯符号（"。。。"、"？？？"、"！"）没有可抽取的信息，套任何模板都是噪声
  if (!/[\p{L}\p{N}]/u.test(raw)) {
    return { text: raw, changed: false, reason: 'too-short', task: 'general', applied, failed }
  }

  const run = (id: string, fn: () => void): void => {
    try {
      fn()
      if (!applied.includes(id)) applied.push(id)
    } catch (error) {
      failed.push({ id, error })
    }
  }

  const finalize = (result: string, task: TaskType, fallbackReason: OptimizeSkipReason): OptimizeResult => {
    const output = result.trim()
    return {
      text: output,
      changed: output !== raw,
      reason: output === raw ? fallbackReason : undefined,
      task,
      applied,
      failed: failed.length > 0 ? failed : undefined
    }
  }

  // 原文已经很清晰：不加结构，只做最小客套清除（规格 §六 验收标准 3）
  if (looksClear(raw)) {
    let result = stripPoliteness(raw)
    run('PASS-CLEAR', () => {})
    if (config.enableRoleOptimization && currentRole) {
      const next = injectRole(result, currentRole)
      if (next !== result) {
        result = next
        run('L3-001', () => {})
      }
    }
    return finalize(result, 'general', 'already-structured')
  }

  const draft: Draft = {
    task: 'general',
    platform: [],
    metric: [],
    table: [],
    stack: [],
    action: '',
    time: '',
    scope: '',
    output: '',
    anomaly: '',
    core: stripPoliteness(raw)
  }

  // ---- Step 1：信息抽取（只读取，不修改文本） ----
  const scene = detectTask(draft.core)
  draft.task = scene.task
  run('S1-SCENE', () => {})

  if (config.extractEntities) {
    run('S1-ENTITY', () => {
      draft.platform = collect(draft.core, PLATFORMS)
      draft.metric = collect(draft.core, METRICS)
      draft.table = collect(draft.core, TABLES)
      draft.stack = collect(draft.core, STACKS)
    })
    run('S1-CONSTRAINT', () => {
      draft.time = draft.core.match(TIME_RE)?.[0]?.trim() ?? ''
      draft.scope = draft.core.match(SCOPE_RE)?.[0]?.trim() ?? ''
      draft.output = draft.core.match(OUTPUT_RE)?.[0]?.trim() ?? ''
      draft.anomaly = pickAnomaly(draft.core)
    })
  }

  if (config.actionOriented) {
    run('S1-ACTION', () => {
      draft.action = detectAction(draft.core)
    })
  }

  // ---- Step 2：紧凑重组 ----
  // 规格 §三：T5 兜底模板**只在「抽不出任何类型」时**使用。因此判定门槛是
  // 「场景识别成功」而不是「置信度高」——把 `写个爬虫`（single 命中）也
  // 打成兜底会让四种场景模板几乎永不生效。
  const effective: Draft = config.applyTemplate && draft.task !== 'general'
    ? draft
    : { ...draft, task: 'general' }
  const fitted = fitBudget(effective, config)
  run(`S2-${fitted.template}`, () => {})
  let result = fitted.text

  if (config.enableRoleOptimization && currentRole) {
    const next = injectRole(result, currentRole)
    if (next !== result) {
      result = next
      run('L3-001', () => {})
    }
  }

  return finalize(result, effective.task, 'no-rule-matched')
}

/** 便捷包装：只要文本结果（供 Node 半边与浏览器半边的调用点使用）。 */
export function localOptimizeText(
  text: string,
  config: LocalRulesConfig,
  currentRole: RoleItem
): string {
  return localOptimize(text, config, currentRole).text
}
