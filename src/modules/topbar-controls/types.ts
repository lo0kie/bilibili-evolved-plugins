/** 顶栏控件模块专有类型（BE 组件通用类型见 src/shared/types.ts） */

export type Side = 'left' | 'right'

/** 扫描到的单个顶栏控件 */
export interface TopbarItem {
  key: string
  label: string
  side: Side
  el: Element
  /** 去掉 query/hash 的链接，没有链接时为空串 */
  href: string
  /** CSS 属性匹配方式：'=' 精确，'^=' 前缀，空串表示不参与 CSS 规则 */
  hrefOp: '' | '=' | '^='
  /** 是否是 B 站 Logo 项（固定/mini 顶栏左侧那个图标，无文字、链接与首页相同） */
  logo: boolean
}

/** 写入 localStorage 的精简结构（不含 DOM 引用） */
export interface CachedItem {
  key: string
  label: string
  side: Side
}
