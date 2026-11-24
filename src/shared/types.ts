/**
 * Bilibili Evolved 组件类型的最小定义。
 * 只声明本项目用到的字段，完整定义见 BE 源码 src/components/types.ts。
 */

/** 设置面板里自动渲染的单个选项 */
export interface OptionMetadata {
  defaultValue: unknown
  displayName?: string
  hidden?: boolean
  slider?: { min?: number; max?: number; step?: number }
}

export interface ComponentTag {
  name: string
  displayName: string
  color: string
  icon: string
  order: number
}

/** 设置项变化回调，签名与 BE 的 ValueChangeListener 一致 */
export type ChangeListener = (value: unknown, oldValue?: unknown) => void

export interface ComponentSettings {
  enabled?: boolean
  options: Record<string, unknown>
}

export interface CoreApis {
  settings: {
    addSettingsChangeListener: (path: string, listener: ChangeListener, initCall?: boolean) => void
    removeSettingsChangeListener: (path: string, listener: ChangeListener) => void
  }
}

export interface ComponentContext {
  settings: ComponentSettings
  metadata: ComponentMetadata
  coreApis: CoreApis
}

export interface InstantStyle {
  name: string
  style: string
}

export interface ComponentMetadata {
  name: string
  displayName: string
  description?: string
  author?: { name: string; link: string }
  tags: ComponentTag[]
  enabledByDefault?: boolean
  options?: Record<string, OptionMetadata>
  instantStyles?: InstantStyle[]
  entry: (context: ComponentContext) => void
  reload?: () => void
  unload?: () => void
}
