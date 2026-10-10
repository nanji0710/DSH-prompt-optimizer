/**
 * 输入框右侧的一键优化按钮。
 *
 * 注册在 `conversation.input.right`（kind: list / scope: session）。该槽位的
 * 占位组件会拿到会话作用域的标准 props，其中：
 *   - `useInput(selector)` 读草稿（InputState.draft 即用户输入的提示词全文）
 *   - `inputActions`      写草稿（setDraft / captureInsertion + insertText）
 * 两者由 @deepseek-ai/dsh-client-ui-conversation 通过 ctx.uiSession.provide 提供。
 *
 * 优化有两条路径：LLM 真改写（走 Node 半边 RPC）优先；宿主不支持或调用失败时
 * 落回本地规则引擎，保证按钮永远给得出结果。
 */
import { useEffect, useRef, useState } from 'react'
import { optimizePrompt, resolveRole } from './optimize'
import {
  OptimizeError,
  isBridgeReady,
  requestOptimize,
  toSettingsPayload,
} from './bridge'
import { getConfig } from './store'

interface InputActionsLike {
  setDraft?: (text: string) => void
}

interface SlotProps {
  useInput?: (selector: (state: { draft?: string }) => string) => string
  inputActions?: InputActionsLike
}

const buttonStyle: Record<string, string | number> = {
  border: 'none',
  background: 'transparent',
  cursor: 'pointer',
  fontSize: 15,
  lineHeight: 1,
  padding: '4px 6px',
  borderRadius: 'var(--dsw-radius-sm, 4px)',
  color: 'var(--dsw-alias-label-secondary, inherit)',
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
}

const hintStyle: Record<string, string | number> = {
  fontSize: 11,
  lineHeight: 1.3,
  marginLeft: 4,
  maxWidth: 220,
  whiteSpace: 'normal',
  color: 'var(--dsw-alias-label-tertiary, inherit)',
}

interface InnerProps {
  useInput: (selector: (state: { draft?: string }) => string) => string
  setDraft: (text: string) => void
}

/** 钩子必须无条件调用，因此把「缺 props」的分支留在外层。 */
function OptimizeButtonInner({ useInput, setDraft }: InnerProps) {
  const draft = useInput((state) => state?.draft ?? '')
  const [previous, setPrevious] = useState<string | null>(null)
  const [hint, setHint] = useState('')
  const [busy, setBusy] = useState(false)
  const abortRef = useRef<AbortController | null>(null)
  /** 上一次由本按钮写进输入框的文本，用来判断草稿后来是否已被消费掉。 */
  const appliedRef = useRef<string | null>(null)
  /** `appliedRef.current` 是否已经真的出现在 draft 里（setDraft 是异步生效的）。 */
  const seenRef = useRef(false)

  const wantsLlm = () => getConfig().optimizeMode === 'llm' && isBridgeReady()

  /** 把优化结果写回输入框，同时记下「这份结果是从哪来的」。 */
  const applyResult = (origin: string, next: string, message: string) => {
    appliedRef.current = next
    seenRef.current = false
    setPrevious(origin)
    setDraft(next)
    setHint(message)
  }

  // 消息发出去之后输入框会被清空，但 previous / hint 是组件本地状态，不会被清。
  // 于是「已优化（LLM 改写）」一直挂着，点 ↩ 还会把发送过的旧内容倒回输入框。
  // 草稿一旦空了、或已被用户改写成别的文本，撤销与提示就都不再成立，就地复位。
  useEffect(() => {
    if (draft === '') {
      appliedRef.current = null
      seenRef.current = false
      setPrevious(null)
      setHint('')
      return
    }
    if (appliedRef.current === null) return
    if (draft === appliedRef.current) {
      seenRef.current = true
      return
    }
    // setDraft 还没反映到 draft 上时不动，避免把自己的写入误判成用户改写。
    if (!seenRef.current) return
    appliedRef.current = null
    seenRef.current = false
    setPrevious(null)
    setHint('')
  }, [draft])

  const run = async () => {
    if (busy) return
    const text = (draft ?? '').trim()
    if (text === '') {
      setHint('输入框为空')
      return
    }

    // 本地规则模式：同步完成，无需等待
    if (!wantsLlm()) {
      const next = optimizePrompt(text)
      if (next === text) {
        setHint('已符合规则')
        return
      }
      applyResult(draft, next, '已优化（本地规则）')
      return
    }

    setBusy(true)
    setHint('正在优化…')
    const controller = new AbortController()
    abortRef.current = controller
    try {
      const optimized = await requestOptimize(
        text,
        toSettingsPayload(getConfig()),
        controller.signal,
      )
      if (optimized === text) {
        setHint('模型认为已足够清晰')
        return
      }
      applyResult(draft, optimized, '已优化（LLM 改写）')
    } catch (error) {
      if (controller.signal.aborted) {
        setHint('已取消')
        return
      }
      // 服务端附带本地降级结果时直接用它，否则现场跑一次本地规则
      const fallback =
        error instanceof OptimizeError && error.fallback ? error.fallback : optimizePrompt(text)
      const reason = error instanceof Error ? error.message : String(error)
      applyResult(draft, fallback, `LLM 失败，已降级为本地规则：${reason}`)
    } finally {
      abortRef.current = null
      setBusy(false)
    }
  }

  const undo = () => {
    if (previous === null) return
    // 先撤掉「本次结果已写入」的记录，否则下面的 effect 会把刚设置的提示又清掉。
    appliedRef.current = null
    seenRef.current = false
    setDraft(previous)
    setPrevious(null)
    setHint('已撤销')
  }

  const cancel = () => {
    abortRef.current?.abort()
  }

  return (
    <>
      <button
        type="button"
        style={{ ...buttonStyle, opacity: busy ? 0.5 : 1 }}
        title={busy ? '正在优化…点击取消' : '一键优化提示词'}
        onClick={() => (busy ? cancel() : void run())}
      >
        {busy ? '⏳' : '✨'}
      </button>
      {previous !== null && !busy && (
        <button type="button" style={buttonStyle} title="撤销本次优化" onClick={undo}>
          ↩
        </button>
      )}
      {hint !== '' && <span style={hintStyle}>{hint}</span>}
    </>
  )
}

let warned = false

export function OptimizeButton(props: SlotProps) {
  const useInput = props?.useInput
  const setDraft = props?.inputActions?.setDraft
  // 槽位不在会话作用域内时拿不到这两个标准 props，此时不渲染。
  if (typeof useInput !== 'function' || typeof setDraft !== 'function') {
    if (!warned) {
      warned = true
      console.warn(
        '[prompt-optimizer] 输入框按钮未渲染：槽位缺少标准会话 props。',
        { useInput: typeof useInput, setDraft: typeof setDraft, keys: Object.keys(props ?? {}) },
      )
    }
    return null
  }
  return <OptimizeButtonInner useInput={useInput} setDraft={setDraft} />
}

export default OptimizeButton
