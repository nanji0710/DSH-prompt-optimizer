import { useState } from 'react'

/**
 * 优化按钮：纯 React 组件，不依赖任何 DSH 客户端包。
 * 点击后弹窗输入文本，调用服务端 promptOptimizer.optimize，展示结果。
 */
export function OptimizeButton() {
  const [open, setOpen] = useState(false)
  const [input, setInput] = useState('')
  const [output, setOutput] = useState('')
  const [loading, setLoading] = useState(false)

  const handleOptimize = async () => {
    if (!input.trim()) return
    setLoading(true)
    try {
      // 服务引用由 index.tsx 的 apply(ctx) 挂到 window.__promptOptimizerSvc
      const svc = window.__promptOptimizerSvc
      if (!svc) {
        setOutput('错误：优化服务未就绪，请重启 DSH')
        return
      }
      const result = await svc.optimize(input)
      setOutput(result)
    } catch (e: any) {
      setOutput('优化失败：' + (e?.message || String(e)))
    } finally {
      setLoading(false)
    }
  }

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        title="一键优化提示词"
        style={{
          border: 'none',
          background: 'transparent',
          cursor: 'pointer',
          fontSize: 16,
          padding: '4px 8px'
        }}
      >
        ✨
      </button>
      {open && (
        <div
          style={{
            position: 'fixed',
            top: 0, left: 0, right: 0, bottom: 0,
            background: 'rgba(0,0,0,.4)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 9999
          }}
          onClick={() => setOpen(false)}
        >
          <div
            style={{
              width: 560,
              maxWidth: '90vw',
              background: '#fff',
              borderRadius: 12,
              padding: 20,
              boxShadow: '0 8px 32px rgba(0,0,0,.2)',
              fontFamily: 'system-ui, sans-serif'
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <h3 style={{ margin: '0 0 12px' }}>✨ 一键优化提示词</h3>
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="输入待优化的提示词..."
              style={{
                width: '100%', height: 120,
                padding: 8,
                border: '1px solid #ddd',
                borderRadius: 6,
                fontSize: 14,
                resize: 'vertical'
              }}
            />
            <div style={{ marginTop: 12, display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button onClick={() => setOpen(false)} style={{ padding: '6px 14px', borderRadius: 6, border: '1px solid #ddd', background: '#fff', cursor: 'pointer' }}>
                关闭
              </button>
              <button
                onClick={handleOptimize}
                disabled={loading}
                style={{ padding: '6px 14px', borderRadius: 6, border: 'none', background: '#4f46e5', color: '#fff', cursor: 'pointer' }}
              >
                {loading ? '优化中...' : '开始优化'}
              </button>
            </div>
            {output && (
              <div style={{ marginTop: 12, padding: 10, background: '#f5f5f5', borderRadius: 6, whiteSpace: 'pre-wrap', fontSize: 13 }}>
                {output}
              </div>
            )}
          </div>
        </div>
      )}
    </>
  )
}
