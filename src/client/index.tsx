/**
 * 客户端入口：只依赖 react（DSH 客户端模块表唯一可用的 seed 包）。
 * 所有插槽注入包 try/catch，即使插槽名不存在也不导致 web boot 崩溃。
 */
import { OptimizeButton } from './OptimizeButton'
import { SettingsPage } from './SettingsPage'

export const name = 'prompt-optimizer'

export function apply(ctx: any) {
  console.log('[prompt-optimizer] client apply, ctx keys:', Object.keys(ctx || {}))

  // 服务引用（客户端能否拿到服务端 provide 的服务待验证）
  try {
    const svc = ctx?.get?.('promptOptimizer')
    if (svc) {
      ;(window as any).__promptOptimizerSvc = svc
      console.log('[prompt-optimizer] got service from ctx.get')
    } else {
      console.warn('[prompt-optimizer] ctx.get(promptOptimizer) returned undefined')
    }
  } catch (e: any) {
    console.warn('[prompt-optimizer] get service failed:', e?.message)
  }

  // 插槽注入（包 try/catch，插槽名待与官方 API 对齐）
  const injectSafe = (slot: string, fn: any) => {
    try {
      ctx?.slots?.inject(slot, fn)
      console.log('[prompt-optimizer] injected slot:', slot)
    } catch (e: any) {
      console.warn('[prompt-optimizer] slot inject failed:', slot, e?.message)
    }
  }

  injectSafe('composer.toolbar.model.before', () => <OptimizeButton />)
  injectSafe('settings.sections', () => ({
    id: 'prompt-optimizer',
    title: '提示词优化助手',
    icon: '✨',
    component: <SettingsPage />
  }))
}

export default apply
