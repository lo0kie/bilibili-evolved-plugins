import { defineComponentMetadata } from '@/components/define'
import type { OptionMetadata, OptionsMetadata } from '@/components/types'
import { observeBodySubtree } from '@/core/observer'
import { TYPES, classify, pgcKeyOf, signatureOf } from './classify'
import type { FeedType } from './classify'
import { seasonTypeOf, setSeasonResolvedListener } from './season'

/**
 * 首页推荐过滤：按类型隐藏首页推荐流里的卡片（直播 / 番剧 / 纪录片 / 电影 / …）。
 *
 * 只做"隐藏"，不动布局、不改排序 —— 隐藏后剩下的卡片自然回填，
 * B 站的无限滚动会继续往下加载。
 */

const NAME = 'homeFeedFilter'
const ATTR = 'data-bhf-hidden'
/** 隐藏前的内联 display 原值，存在元素自己的属性上（卡片会被 Vue 复用，属性跟着节点走） */
const DISPLAY_ATTR = 'data-bhf-display'

/**
 * 卡片外层。四类节点都要收：
 *   `.feed-card`         普通投稿的外层容器
 *   `.bili-video-card`   卡片本体（骨架屏阶段只有它）
 *   `.bili-live-card`    直播卡
 *   `.floor-single-card` 楼层卡（直播 / 番剧 / 综艺 / 电影 等推荐位专用节点）
 */
const CARD_SELECTOR = '.feed-card, .bili-video-card, .bili-live-card, .floor-single-card'

/** 判定缓存：卡片被 Vue 复用、内容变了要重判，用指纹校验 */
const typeCache = new WeakMap<Element, { sig: string; type: FeedType }>()

/** PGC 六类：只有这几类勾了才需要去查 season 接口，否则一个请求都不发 */
const PGC_TYPES: FeedType[] = ['bangumi', 'movie', 'doc', 'guochuang', 'tv', 'variety']
let needPgcResolution = false

/** 类名不认识、但被"网格兄弟"规则认出来的卡片 */
const extraCards = new Set<HTMLElement>()

/** 找到"真正占格子"的那一层（往上爬，遇到 grid/flex 或含多张卡的容器就停） */
function slotOf(card: HTMLElement): HTMLElement {
  let el: HTMLElement = card
  for (let i = 0; i < 4; i += 1) {
    const parent = el.parentElement
    if (!parent || parent === document.body || parent === document.documentElement) {
      break
    }
    const display = getComputedStyle(parent).display
    if (
      display === 'grid' ||
      display === 'flex' ||
      display === 'inline-grid' ||
      display === 'inline-flex'
    ) {
      break
    }
    if (parent.querySelectorAll(CARD_SELECTOR).length > 1) {
      break
    }
    el = parent
  }
  return el
}

function hideCard(card: HTMLElement): void {
  const slot = slotOf(card)
  if (!slot.hasAttribute(ATTR)) {
    slot.setAttribute(DISPLAY_ATTR, slot.style.getPropertyValue('display'))
  }
  slot.setAttribute(ATTR, '1')
  slot.style.setProperty('display', 'none', 'important')
}

function restoreSlot(slot: HTMLElement): void {
  const original = slot.getAttribute(DISPLAY_ATTR) ?? ''
  slot.removeAttribute(ATTR)
  slot.removeAttribute(DISPLAY_ATTR)
  if (original && original !== 'none') {
    slot.style.setProperty('display', original)
  } else {
    slot.style.removeProperty('display')
  }
}

function isHidden(card: HTMLElement): boolean {
  return slotOf(card).hasAttribute(ATTR)
}

function collectCards(): HTMLElement[] {
  const all = Array.from(document.querySelectorAll<HTMLElement>(CARD_SELECTOR))
  const top = all.filter(el => !el.parentElement?.closest(CARD_SELECTOR))

  const out: HTMLElement[] = []
  for (const el of top) {
    const nested = el.querySelectorAll<HTMLElement>(CARD_SELECTOR)
    if (nested.length >= 2) {
      // 整块容器：展开成最内层卡片，逐个判定
      nested.forEach(child => {
        if (!child.querySelector(CARD_SELECTOR)) {
          out.push(child)
        }
      })
    } else {
      out.push(el)
    }
  }

  // 兜底：按"网格兄弟"补齐未知卡片类型（PGC 卡的类名和普通卡不同）
  const seen = new Set<HTMLElement>(out)
  extraCards.forEach(el => {
    if (!el.isConnected) {
      extraCards.delete(el)
    } else if (!seen.has(el) && !el.parentElement?.closest(CARD_SELECTOR)) {
      seen.add(el)
      out.push(el)
    }
  })
  if (out.length < 120) {
    for (const card of out.slice()) {
      const parent = card.parentElement
      if (!parent) {
        continue
      }
      const baseWidth = card.offsetWidth
      const baseHeight = card.offsetHeight
      const baseTop = card.offsetTop
      for (const sibling of Array.from(parent.children) as HTMLElement[]) {
        if (sibling === card || seen.has(sibling) || sibling.querySelector(CARD_SELECTOR)) {
          continue
        }
        // 同排、同宽（±10%）、同高（±30%）、有图、链接 ≤4 个
        if (Math.abs(sibling.offsetTop - baseTop) > 8) {
          continue
        }
        if (Math.abs(sibling.offsetWidth - baseWidth) > Math.max(16, baseWidth * 0.1)) {
          continue
        }
        if (Math.abs(sibling.offsetHeight - baseHeight) > Math.max(32, baseHeight * 0.3)) {
          continue
        }
        if (!sibling.querySelector('img')) {
          continue
        }
        const links = sibling.querySelectorAll('a[href]')
        if (links.length === 0 || links.length > 4) {
          continue
        }
        const href = links[0].getAttribute('href') ?? ''
        if (!/(\/video\/|\/bangumi\/|live\.bilibili\.com|\/cheese\/)/.test(href)) {
          continue
        }
        seen.add(sibling)
        extraCards.add(sibling)
        out.push(sibling)
      }
    }
  }
  return out
}

function typeOf(card: Element): FeedType {
  const sig = signatureOf(card)
  const hit = typeCache.get(card)
  if (hit && hit.sig === sig) {
    return hit.type
  }
  const base = classify(card)

  // PGC：解析前按「番剧」处理且不写缓存，解析结果由监听器触发 apply 纠正
  if (base === 'bangumi') {
    const key = pgcKeyOf(card)
    if (key) {
      const resolved = seasonTypeOf(key, needPgcResolution)
      if (!resolved) {
        return 'bangumi'
      }
      typeCache.set(card, { sig, type: resolved })
      return resolved
    }
  }

  typeCache.set(card, { sig, type: base })
  return base
}

/** 选项名统一 `hide_<type>`，与 TYPES 一一对应 */
function buildOptions(): OptionsMetadata {
  const options: OptionsMetadata = {}
  TYPES.forEach(type => {
    options[`hide_${type.key}`] = {
      defaultValue: false,
      displayName: `过滤 · ${type.label}`,
    } satisfies OptionMetadata
  })
  return options
}

/** entry 里注册的卸载逻辑，由顶层 unload() 调用 */
let dispose = () => {}

export const component = defineComponentMetadata({
  name: NAME,
  displayName: '首页推荐过滤',
  author: {
    name: 'local',
    link: 'https://github.com/the1812/Bilibili-Evolved',
  },
  tags: [
    {
      name: 'utils',
      displayName: '工具',
      color: '#A36FFD',
      icon: 'mdi-rocket-launch-outline',
      order: 5,
    },
  ],
  enabledByDefault: false,
  options: buildOptions(),
  instantStyles: [
    {
      name: 'bhf-feed-hidden',
      style: '[data-bhf-hidden]{display:none!important}',
    },
  ],

  entry(context) {
    const { settings, coreApis } = context
    let disconnect = () => {}
    let timers: number[] = []

    const apply = (): void => {
      const opts = settings.options ?? {}
      needPgcResolution = PGC_TYPES.some(t => opts[`hide_${t}`] === true)
      const cards = collectCards()
      const keepSlots = new Set<Element>()
      let hidden = 0

      cards.forEach(card => {
        const type = typeOf(card)
        const shouldHide = type !== 'video' && opts[`hide_${type}`] === true
        if (shouldHide) {
          keepSlots.add(slotOf(card))
          if (!isHidden(card)) {
            hideCard(card)
          }
          hidden += 1
        }
      })

      document.querySelectorAll<HTMLElement>(`[${ATTR}]`).forEach(slot => {
        if (!keepSlots.has(slot)) {
          restoreSlot(slot)
        }
      })
    }

    apply()

    setSeasonResolvedListener(() => apply())

    disconnect = observeBodySubtree(() => apply())

    timers = [600, 1500].map(ms => window.setTimeout(apply, ms))

    coreApis.settings.addSettingsChangeListener(
      `userComponents.${NAME}.settings.options`,
      () => apply(),
      true
    )

    dispose = () => {
      disconnect()
      timers.forEach(id => window.clearTimeout(id))
      timers = []
      document.querySelectorAll<HTMLElement>(`[${ATTR}]`).forEach(restoreSlot)
    }
  },

  reload() {
    // 重新开启时无需额外动作：observer 仍在，设置监听器仍在；apply 会在下一次触发时重跑
  },

  unload() {
    dispose()
    dispose = () => {}
  },
})
