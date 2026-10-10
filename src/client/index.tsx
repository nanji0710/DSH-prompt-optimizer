/**
 * 客户端插件入口（浏览器半边）。
 *
 * 关键契约：宿主 cordis 通过插件对象上的 `inject` 字段做依赖注入
 * （`new Fiber(ctx, config, Inject.resolve(plugin.inject), ...)`）。没有声明
 * `slots` 时，`ctx.slots` 的代理 getter 会沿 fiber 父链一路抛
 * `cannot get property "slots" without inject`，整个插件 fiber 进入 FAILED，
 * 结果是按钮与设置页都不出现、且只留一行 web-boot 报错。
 *
 * 注册必须走 `ctx.slots.inject(ownerKey, () => ctx.slots.register(...))`：
 * 槽位由父条目的 children 表声明，未声明时直接 register 会抛。
 *
 * 跨半边通道走宿主侧注册的 `/api/prompt-optimizer/*` HTTP 端点（见 bridge.ts），
 * 浏览器半边直接同源 fetch 即可，**不需要注入 connection** —— 因此这里没有任何
 * 可选依赖注入，插件在缺少 connection 的宿主上也能正常渲染按钮。
 */
import { OptimizeButton } from './OptimizeButton'
import { SettingsPage } from './SettingsPage'

export const name = 'prompt-optimizer'

/** 插件级注入声明（服务名，非包名）。只列必然存在的服务。 */
export const inject = ['slots']

const INPUT_SLOT = 'conversation.input.right'
const SETTINGS_SLOT = 'settings.section'

export function apply(ctx: any): void {
  ctx.slots.inject(INPUT_SLOT, () =>
    ctx.slots.register(
      { name: INPUT_SLOT, id: 'prompt-optimizer-btn', order: 100, label: '一键优化提示词' },
      OptimizeButton,
    ),
  )

  ctx.slots.inject(SETTINGS_SLOT, () =>
    ctx.slots.register(
      {
        name: SETTINGS_SLOT,
        id: 'prompt-optimizer',
        order: 30,
        label: () => '✨ 提示词优化助手',
      },
      SettingsPage,
    ),
  )
}

export default { name, inject, apply }
