/**
 * Bilibili Evolved 组件类型 —— 与 BE 主仓库 `src/components/types.ts` 对齐的最小子集。
 *
 * 这里只声明本项目用到的字段，字段名、语义、注释都与 BE 保持一致。
 * 完整定义见 https://github.com/the1812/Bilibili-Evolved 的 src/components/types.ts。
 *
 * 本仓库同时服务两条路径：
 *   - `registry/` 下的组件源码会被直接拷进 BE 主仓库，`@/` 别名由 BE 的 webpack 解析；
 *   - `src/` 下的独立构建产物走自己的 build.mjs，类型引用同一份定义。
 */

/** 作者信息：`name` 通常是 GitHub 用户名，`link` 是 Profile 页地址 */
export interface Author {
  name: string
  link: string
}

/** 组件标签：与 BE 的 componentsTags 里的条目同构 */
export interface ComponentTag {
  name: string
  displayName: string
  color: string
  icon: string
  order: number
}

/** 单个选项的信息 */
export interface OptionMetadata {
  /** 默认值 */
  defaultValue: unknown
  /** 显示名称 */
  displayName?: string
  /** 设为 true 时不显示在设置面板中 */
  hidden?: boolean
  /** 设为 true 时用颜色选取器替代文本框 */
  color?: boolean
  /** 设为 true 时使用多行文本框 */
  multiline?: boolean
  /** 下拉框选值 */
  dropdownEnum?: unknown
  /** 设置范围，可以显示为滑动条 */
  slider?: { min?: number; max?: number; step?: number }
}

/** 多个选项的信息 */
export type OptionsMetadata = Record<string, OptionMetadata>

/** 即时样式：首屏尽快注入 */
export interface InstantStyleDefinition {
  name: string
  style: string
}

/** 设置项变化监听器 */
export type ValueChangeListener = (value: unknown, oldValue?: unknown) => void

/** 组件设置 */
export interface ComponentSettings {
  enabled?: boolean
  options: Record<string, unknown>
}

/** 核心 API（本项目只用 settings 子集） */
export interface CoreApis {
  settings: {
    addSettingsChangeListener: (
      path: string,
      listener: ValueChangeListener,
      initCall?: boolean
    ) => void
    removeSettingsChangeListener: (path: string, listener: ValueChangeListener) => void
  }
}

/** 组件入口函数参数 */
export interface ComponentEntryContext {
  settings: ComponentSettings
  metadata: ComponentMetadata
  coreApis: CoreApis
}

/** 组件入口函数 */
export type ComponentEntry = (context: ComponentEntryContext) => void

/** 组件的完整元数据 */
export interface ComponentMetadata {
  name: string
  displayName: string
  /** 描述，由 index.md 注入，不需要手动填写 */
  description?: string
  author?: Author | Author[]
  tags: ComponentTag[]
  enabledByDefault?: boolean
  options?: OptionsMetadata
  instantStyles?: InstantStyleDefinition[]
  entry: ComponentEntry
  /** 重新开启时执行，需与 unload 成对 */
  reload?: () => void
  /** 关闭时执行，需与 reload 成对 */
  unload?: () => void
}
