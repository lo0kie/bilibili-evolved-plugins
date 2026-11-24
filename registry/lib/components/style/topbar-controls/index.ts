import { defineComponentMetadata } from '@/components/define'
import type { OptionMetadata, OptionsMetadata } from '@/components/types'
import { observeBodySubtree } from '@/core/observer'
import { mergeItems, readCache, saveCache } from './cache'
import { isAccountItem, scanNow } from './scan'
import { GAP_OPTIONS, MISC_OPTIONS, removeStyleCss, updateStyleCss } from './styles'
import type { CachedItem, TopbarItem } from './types'

/**
 * 顶栏控件管理：动态扫描 B 站顶栏控件，每个控件一个开关。
 *
 * 选项分两组（BE 的 OptionMetadata 没有分组能力，靠"名称前缀 + 顺序"实现）：
 *   「显隐」逐个控制顶栏控件（开启 = 显示，关闭 = 隐藏）
 *   「其它」间距、提示条、固定分区栏、常驻顶部等行为设置
 */

const NAME = 'topbarControls'
const ATTR = 'data-bhc-hidden'

/** 内联 display 的原始值，卸载时还原 */
const savedDisplay = new WeakMap<Element, string>()

function hideEl(el: Element): void {
  el.setAttribute(ATTR, '1')
  const style = (el as HTMLElement).style
  if (!style) {
    return
  }
  if (!savedDisplay.has(el)) {
    savedDisplay.set(el, style.getPropertyValue('display'))
  }
  style.setProperty('display', 'none', 'important')
}

/** 右侧"视觉上真正贴边"的位置（只取叶子节点，排除隐藏弹层） */
function rightmostLeafEdge(root: Element): number {
  let edge = Number.NEGATIVE_INFINITY
  const visible = (el: Element): boolean => {
    const rect = el.getBoundingClientRect()
    if (rect.width <= 0 || rect.height <= 0) {
      return false
    }
    const style = getComputedStyle(el)
    return style.visibility !== 'hidden' && style.opacity !== '0' && style.display !== 'none'
  }
  const walk = (el: Element): void => {
    if (!visible(el)) {
      return
    }
    const kids = Array.prototype.filter.call(el.children, (child: Element) =>
      visible(child)
    ) as Element[]
    if (kids.length === 0) {
      edge = Math.max(edge, el.getBoundingClientRect().right)
      return
    }
    kids.forEach(walk)
  }
  walk(root)
  return edge
}

/** 左侧区块的额外位移（px），落地到 .left-entry 的 margin-left */
let alignOffset = 0
const savedMargin = new WeakMap<HTMLElement, string>()

function leftEntryEl(): HTMLElement | null {
  const bar = document.querySelector('.bili-header__bar')
  return (bar?.querySelector('.left-entry') as HTMLElement | null) ?? null
}

function writeAlignOffset(): void {
  const left = leftEntryEl()
  if (!left) {
    return
  }
  if (!savedMargin.has(left)) {
    savedMargin.set(left, left.style.getPropertyValue('margin-left'))
  }
  const original = savedMargin.get(left) ?? ''
  const target = alignOffset === 0 ? original : `${Math.round(alignOffset)}px`
  if (left.style.getPropertyValue('margin-left') === target) {
    return
  }
  if (target) {
    left.style.setProperty('margin-left', target, 'important')
  } else {
    left.style.removeProperty('margin-left')
  }
}

function clearAlignOffset(): void {
  alignOffset = 0
  const left = leftEntryEl()
  if (left) {
    const original = savedMargin.get(left) ?? ''
    if (original) {
      left.style.setProperty('margin-left', original)
    } else {
      left.style.removeProperty('margin-left')
    }
    savedMargin.delete(left)
  }
  const bar = document.querySelector('.bili-header__bar') as HTMLElement | null
  bar?.style.removeProperty('padding-left')
  bar?.style.removeProperty('padding-right')
}

/**
 * 左右边缘对齐（运行时实测校准）。只移动左侧，右侧的触发区、弹层锚点保持原地。
 */
function normalizeRightInset(opts?: Record<string, unknown>): void {
  const bar = document.querySelector('.bili-header__bar') as HTMLElement | null
  const left = bar?.querySelector('.left-entry')
  const right = bar?.querySelector('.right-entry')
  if (!bar || !left || !right) {
    return
  }
  if (opts && opts.alignRightEdge === false) {
    if (alignOffset !== 0) {
      clearAlignOffset()
    }
    return
  }
  if (typeof right.matches === 'function' && right.matches(':hover')) {
    return
  }
  const first = Array.prototype.find.call(
    left.querySelectorAll('.left-entry__item'),
    (el: Element) => el.getBoundingClientRect().width > 0
  ) as Element | undefined
  if (!first) {
    return
  }
  const barRect = bar.getBoundingClientRect()
  if (barRect.width < 320) {
    return
  }
  const gapLeft = first.getBoundingClientRect().left
  const rightEdge = rightmostLeafEdge(right)
  if (!Number.isFinite(rightEdge)) {
    return
  }
  const gapRight = window.innerWidth - rightEdge
  const delta = Math.round(gapRight - gapLeft)
  if (delta === 0) {
    return
  }
  const next = Math.max(-30, Math.min(72, alignOffset + delta))
  if (next === alignOffset) {
    return
  }
  alignOffset = next
  writeAlignOffset()
}

/** 头像保活：只要含头像的节点还挂着隐藏标记或内联 display:none，就地复原 */
function protectAvatar(): void {
  if (document.querySelector('.mini-avatar--large')) {
    return
  }
  let node = document.querySelector('.header-avatar-wrap') as HTMLElement | null
  for (let i = 0; i < 4 && node; i += 1) {
    if (node.hasAttribute(ATTR)) {
      node.removeAttribute(ATTR)
    }
    const style = node.style
    if (style && style.getPropertyValue('display') === 'none') {
      style.removeProperty('display')
    }
    node = node.parentElement
  }
}

function restoreAll(): void {
  document.querySelectorAll(`[${ATTR}]`).forEach(el => {
    el.removeAttribute(ATTR)
    const style = (el as HTMLElement).style
    if (!style) {
      return
    }
    const original = savedDisplay.get(el) ?? ''
    if (original) {
      style.setProperty('display', original)
    } else {
      style.removeProperty('display')
    }
    savedDisplay.delete(el)
  })
}

interface Bootstrap {
  items: CachedItem[]
  options: OptionsMetadata
  hasLive: boolean
}

const GROUP_SHOW = '显隐'
const GROUP_MISC = '其它'

function groupLabel(group: string, name: string): string {
  return `${group} · ${name}`
}

function withGroupPrefix(list: Record<string, OptionMetadata>): Record<string, OptionMetadata> {
  const out: Record<string, OptionMetadata> = {}
  Object.entries(list).forEach(([key, meta]) => {
    out[key] = { ...meta, displayName: groupLabel(GROUP_MISC, meta.displayName ?? key) }
  })
  return out
}

/** 代码执行阶段就生成选项（此时 DOM 可能还没就绪）：实时扫描优先，扫不到用缓存补齐 */
const bootstrap: Bootstrap = (() => {
  const live = scanNow()
  const merged = mergeItems(live, readCache())
  if (live.length > 0) {
    saveCache(merged)
  }

  const options: Record<string, OptionMetadata> = {}
  merged.forEach(item => {
    options[`show_${item.key}`] = {
      defaultValue: true,
      displayName: groupLabel(GROUP_SHOW, item.label),
    }
  })
  Object.assign(options, withGroupPrefix(GAP_OPTIONS), withGroupPrefix(MISC_OPTIONS))

  return { items: merged, options, hasLive: live.length > 0 }
})()

/** entry 里注册的卸载逻辑，由顶层 unload() 调用 */
let dispose = () => {}

export const component = defineComponentMetadata({
  name: NAME,
  displayName: '顶栏控件管理',
  author: {
    name: 'local',
    link: 'https://github.com/the1812/Bilibili-Evolved',
  },
  tags: [
    {
      name: 'style',
      displayName: '样式',
      color: '#8BC34A',
      icon: 'mdi-palette-outline',
      order: 2,
    },
  ],
  enabledByDefault: false,
  options: bootstrap.options,
  instantStyles: [
    {
      name: 'bhc-topbar-hidden',
      style: '[data-bhc-hidden]{display:none!important}',
    },
  ],

  entry(context) {
    const { settings, metadata, coreApis } = context
    let disconnect = () => {}
    let applying = false

    const apply = (): void => {
      if (applying) {
        return
      }
      applying = true
      try {
        const live = scanNow()

        restoreAll()

        if (!metadata.options) {
          metadata.options = {}
        }
        const metaOptions = metadata.options
        let discovered = 0
        live.forEach(item => {
          const key = `show_${item.key}`
          if (!(key in metaOptions)) {
            metaOptions[key] = {
              defaultValue: true,
              displayName: groupLabel(GROUP_SHOW, item.label),
            }
            discovered += 1
          }
        })
        if (discovered > 0) {
          saveCache(mergeItems(live, readCache()))
        }

        const opts = settings.options ?? {}
        const hidden: TopbarItem[] = []
        const liveKeys = new Set<string>()
        live.forEach(item => {
          const key = `show_${item.key}`
          liveKeys.add(key)
          if (opts[key] === false && !isAccountItem(item.el)) {
            hideEl(item.el)
            hidden.push(item)
          }
        })
        updateStyleCss(hidden, opts)
        protectAvatar()
        writeAlignOffset()
      } finally {
        applying = false
      }
    }

    apply()

    const headerBar = document.querySelector('.bili-header__bar') as HTMLElement | null
    headerBar?.style.removeProperty('padding-left')
    headerBar?.style.removeProperty('padding-right')
    protectAvatar()

    const scheduleAlign = (): void => {
      requestAnimationFrame(() => normalizeRightInset(settings.options ?? {}))
    }
    scheduleAlign()
    window.setTimeout(() => normalizeRightInset(settings.options ?? {}), 600)

    disconnect = observeBodySubtree(() => apply())

    const onResize = (): void => {
      apply()
      scheduleAlign()
    }
    window.addEventListener('resize', onResize)

    const onOptionsChange = (): void => {
      apply()
      scheduleAlign()
    }
    coreApis.settings.addSettingsChangeListener(
      `userComponents.${NAME}.settings.options`,
      onOptionsChange,
      true
    )

    dispose = () => {
      disconnect()
      coreApis.settings.removeSettingsChangeListener(
        `userComponents.${NAME}.settings.options`,
        onOptionsChange
      )
      window.removeEventListener('resize', onResize)
      restoreAll()
      removeStyleCss()
      clearAlignOffset()
    }
  },

  reload() {
    // 重新开启时无需额外动作：observer / 监听器仍在，下一轮 apply 会重跑
  },

  unload() {
    dispose()
    dispose = () => {}
  },
})
