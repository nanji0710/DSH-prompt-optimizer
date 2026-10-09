/**
 * DSH 宿主运行时模块声明
 * 这些包由 DSH 宿主环境提供，不在公共 npm 发布，本地仅做类型占位。
 */

declare module 'cordis' {
  export class Plugin {
    ctx: any
    constructor(ctx?: any)
    apply(): void
  }
}

declare module '@deepseek-ai/dsh-client-runtime' {
  export function useService(name: string): any
}

declare module '@deepseek-ai/dsh-client-composer' {
  export interface ComposerApi {
    value: string
    setValue: (value: string) => void
  }
  export function useComposer(): ComposerApi
}

declare module '@deepseek-ai/dsh-client-settings' {
  export type ConfigSetter = (key: string, value: any) => void
  export function useConfig(): [any, ConfigSetter]
}

declare module '@deepseek-ai/dsh-client-ui' {
  export const Form: any
  export const Switch: any
  export const Select: any
  export const Input: any
  export const TextArea: any
  export const Card: any
  export const Button: any
  export const Modal: any
  export const List: any
  export const Dropdown: any
  export const MenuItem: any
}
