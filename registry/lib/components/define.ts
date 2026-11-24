import type { ComponentMetadata } from './types'

/**
 * 定义组件元数据（与 BE 的 `@/components/define` 同签名）。
 *
 * 在 BE 主仓库里这是一个空操作函数，作用是让 TypeScript 推断出精确的
 * OptionsMetadata 类型（这样 `settings.options.hide_live` 才能带类型）。
 * 本仓库里由于选项是运行时动态生成的，因此只做透传 + 类型标注。
 */
export const defineComponentMetadata = (metadata: ComponentMetadata): ComponentMetadata => metadata

/** 定义单个选项元数据（同 BE 签名，透传） */
export const defineOptionMetadata = <V>(
  m: { defaultValue: V } & Record<string, unknown>
): typeof m => m
