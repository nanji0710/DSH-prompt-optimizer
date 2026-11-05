/**
 * 自带主题的下拉选择器。
 *
 * 为什么不用原生 `<select>`：它的下拉弹层由浏览器自己绘制，配色不走我们的 CSS token。
 * 宿主的前端 CSS 里一次都没声明 `color-scheme`，所以深色模式下弹层仍是白底，而选项文字
 * 继承的是深色主题的浅色 token——白底浅字，几乎读不出来。
 *
 * 给 `<select>` 补 `color-scheme` 也没能修好（实测弹层仍按浅色绘制），所以改成自绘列表：
 * 底板、文字、悬停、选中全部走 `--dsw-alias-*` 主题 token，跟着页面主题走。
 */
import { useEffect, useRef, useState } from 'react'

export interface SelectOption {
  value: string
  label: string
  /** 分组标题：渲染在该项上方的不可点行，用空值项占位时留空。 */
  group?: string
}

interface SelectProps {
  /** 无障碍名；同时用于按钮的 title 提示。 */
  label: string
  value: string
  options: SelectOption[]
  onChange: (value: string) => void
}

const triggerStyle: Record<string, string | number> = {
  width: '100%',
  boxSizing: 'border-box',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 8,
  padding: '6px 8px',
  fontSize: 13,
  font: 'inherit',
  textAlign: 'left',
  color: 'var(--dsw-alias-label-primary, inherit)',
  background: 'var(--dsw-alias-bg-base, transparent)',
  border: '1px solid var(--dsw-alias-border-l2, currentColor)',
  borderRadius: 'var(--dsw-radius-sm, 4px)',
  cursor: 'pointer',
}

const triggerTextStyle: Record<string, string | number> = {
  flex: '1 1 auto',
  minWidth: 0,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
}

const caretStyle: Record<string, string | number> = {
  flex: '0 0 auto',
  fontSize: 11,
  lineHeight: 1,
  color: 'var(--dsw-alias-label-tertiary, inherit)',
}

const listStyleBase: Record<string, string | number> = {
  position: 'absolute',
  left: 0,
  right: 0,
  zIndex: 40,
  maxHeight: 280,
  overflowY: 'auto',
  padding: 4,
  boxSizing: 'border-box',
  background: 'var(--dsw-alias-bg-layer-1, Canvas)',
  border: '1px solid var(--dsw-alias-border-l2, currentColor)',
  borderRadius: 'var(--dsw-radius-sm, 4px)',
}

const itemStyle: Record<string, string | number> = {
  display: 'block',
  width: '100%',
  boxSizing: 'border-box',
  padding: '6px 8px',
  fontSize: 12,
  textAlign: 'left',
  font: 'inherit',
  color: 'var(--dsw-alias-label-primary, inherit)',
  background: 'transparent',
  border: 'none',
  borderRadius: 'var(--dsw-radius-sm, 4px)',
  cursor: 'pointer',
  whiteSpace: 'normal',
}

const groupStyle: Record<string, string | number> = {
  padding: '6px 8px 4px',
  fontSize: 11,
  color: 'var(--dsw-alias-label-tertiary, inherit)',
}

export function Select({ label, value, options, onChange }: SelectProps) {
  const [open, setOpen] = useState(false)
  const [hover, setHover] = useState(-1)
  /** 下方空间不足时改成向上弹出，避免被设置面板的滚动容器裁掉（例如页面最底部的「优化角色」）。 */
  const [dropUp, setDropUp] = useState(false)
  const rootRef = useRef<HTMLDivElement | null>(null)

  const measure = () => {
    const root = rootRef.current
    if (root === null) return
    const rect = root.getBoundingClientRect()
    const below = window.innerHeight - rect.bottom
    setDropUp(below < 260 && rect.top > below)
  }

  // 点外部关闭；打开期间才挂监听，避免常驻。
  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: Event) => {
      const root = rootRef.current
      if (root !== null && event.target instanceof Node && root.contains(event.target)) return
      setOpen(false)
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  const current = options.find((option) => option.value === value)
  // 已保存但当前候选里没有的值，也要能显示出来，不能让下拉悄悄把它改掉。
  const display = current?.label ?? value

  return (
    <div ref={rootRef} style={{ position: 'relative' }}>
      <button
        type="button"
        style={triggerStyle}
        title={label}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => {
          setHover(-1)
          if (!open) measure()
          setOpen((prev) => !prev)
        }}
      >
        <span style={triggerTextStyle}>{display === '' ? '（未选择）' : display}</span>
        <span style={caretStyle}>{open ? '▲' : '▼'}</span>
      </button>

      {open && (
        <div
          style={{
            ...listStyleBase,
            ...(dropUp ? { bottom: 'calc(100% + 4px)' } : { top: 'calc(100% + 4px)' }),
          }}
          role="listbox"
        >
          {options.map((option, index) => {
            // 分组标题只在「本组第一项」之前渲染一次，否则每个选项都会顶着一个同样的标题。
            const showGroup =
              option.group !== undefined &&
              option.group !== '' &&
              (index === 0 || options[index - 1].group !== option.group)
            return (
              <div key={`${option.group ?? ''}#${option.value}#${index}`}>
                {showGroup && <div style={groupStyle}>{option.group}</div>}
                <button
                  type="button"
                  role="option"
                  aria-selected={option.value === value}
                  style={{
                    ...itemStyle,
                    ...(option.value === value
                      ? { background: 'var(--dsw-alias-interactive-bg-active, transparent)' }
                      : {}),
                    ...(index === hover && option.value !== value
                      ? { background: 'var(--dsw-alias-interactive-bg-hover, transparent)' }
                      : {}),
                  }}
                  onMouseEnter={() => setHover(index)}
                  onMouseLeave={() => setHover(-1)}
                  onClick={() => {
                    onChange(option.value)
                    setOpen(false)
                  }}
                >
                  {option.label === '' ? '（未选择）' : option.label}
                </button>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

export default Select
