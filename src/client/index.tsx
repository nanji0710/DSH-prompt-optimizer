/**
 * 客户端入口：通过 DSH 插槽注入优化按钮与设置页面
 * 命名导出 name / apply，同时默认导出 apply 以兼容 loader。
 */
import { OptimizeButton } from './OptimizeButton'
import { SettingsPage } from './SettingsPage'

export const name = 'prompt-optimizer'

export function apply(ctx: any) {
  // 插槽：输入框工具栏，模型选择器左侧
  ctx.slots.inject('composer.toolbar.model.before', () => <OptimizeButton />)

  // 插槽：系统设置面板
  ctx.slots.inject('settings.sections', () => ({
    id: 'prompt-optimizer',
    title: '提示词优化助手',
    icon: '✨',
    component: <SettingsPage />
  }))
}

export default apply
