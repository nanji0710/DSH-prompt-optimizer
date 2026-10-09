/**
 * 客户端入口：通过 DSH 插槽注入优化按钮与设置页面
 */
import { Plugin } from 'cordis'
import { OptimizeButton } from './OptimizeButton'
import { SettingsPage } from './SettingsPage'

export default class PromptOptimizerClient extends Plugin {
  apply() {
    // 插槽：输入框工具栏，模型选择器左侧
    this.ctx.slots.inject('composer.toolbar.model.before', () => <OptimizeButton />)

    // 插槽：系统设置面板
    this.ctx.slots.inject('settings.sections', () => ({
      id: 'prompt-optimizer',
      title: '提示词优化助手',
      icon: '✨',
      component: <SettingsPage />
    }))
  }
}
