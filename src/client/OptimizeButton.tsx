/**
 * 一键优化按钮：读取输入框内容 → 调用优化服务 → 回填，并支持撤销
 */
import { useState, useRef } from 'react'
import { useService } from '@deepseek-ai/dsh-client-runtime'
import { useComposer } from '@deepseek-ai/dsh-client-composer'

export const OptimizeButton = () => {
  const [loading, setLoading] = useState(false)
  const [canUndo, setCanUndo] = useState(false)
  const promptOptimizer = useService('promptOptimizer')
  const { value, setValue } = useComposer()
  const lastValueRef = useRef<string>('')

  const handleOptimize = async () => {
    if (!value || !value.trim() || loading) return
    setLoading(true)
    lastValueRef.current = value
    try {
      const optimized = await promptOptimizer.optimize(value)
      setValue(optimized)
      setCanUndo(true)
    } catch (e) {
      console.error('[提示词优化] 优化失败：', e)
    } finally {
      setLoading(false)
    }
  }

  const handleUndo = () => {
    if (lastValueRef.current) {
      setValue(lastValueRef.current)
      setCanUndo(false)
    }
  }

  return (
    <div style={{ display: 'flex', alignItems: 'center', marginRight: 8, gap: 4 }}>
      <button
        className="dsw-button dsw-button-ghost dsw-button-sm"
        onClick={handleOptimize}
        disabled={loading || !value || !value.trim()}
        title="一键优化当前提示词"
      >
        {loading ? '优化中...' : '✨ 优化提示词'}
      </button>

      {canUndo && (
        <button
          className="dsw-button dsw-button-ghost dsw-button-sm"
          onClick={handleUndo}
          title="撤销优化，恢复原文"
        >
          ↩ 撤销
        </button>
      )}
    </div>
  )
}
