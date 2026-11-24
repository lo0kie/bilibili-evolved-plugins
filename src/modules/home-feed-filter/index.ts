import type { ComponentMetadata, OptionMetadata } from '../../shared/types'
import {
  TYPES,
  classify,
  cornerText,
  explain,
  pgcKeyOf,
  shortTexts,
  signatureOf,
  structHints,
  vocab,
} from './classify'
import type { FeedType } from './classify'
import { seasonStats, seasonTypeOf, setSeasonResolvedListener } from './season'

/**
 * 首页推荐过滤：按类型隐藏首页推荐流里的卡片（直播 / 番剧 / 纪录片 / 电影 / …）。
 *
 * 只做"隐藏"，不动布局、不改排序 —— 隐藏后剩下的卡片自然回填，
 * B 站的无限滚动会继续往下加载。
 *
 * 沙箱约束：必须整段 IIFE（esbuild iife），导出走 globalName + footer，见 build.mjs。
 */

declare const unsafeWindow: Window & { __bhf__?: unknown }

const NAME = 'homeFeedFilter'
const VERSION = '1.4.1'
const ATTR = 'data-bhf-hidden'
/**
 * 隐藏前的内联 display 原值，**存在元素自己的属性上**。
 * 不用 WeakMap：卡片会被 Vue 复用 / 重建，WeakMap 里的记录会跟着旧节点一起丢，
 * 而属性跟着节点走，恢复时一定读得到。
 */
const DISPLAY_ATTR = 'data-bhf-display'

/**
 * 卡片外层。三种都要收：
 *   `.feed-card`         普通投稿的外层容器
 *   `.bili-video-card`   卡片本体（骨架屏阶段只有它）
 *   `.bili-live-card`    直播卡
 *   `.floor-single-card` **楼层卡** —— 直播 / 番剧 / 综艺 / 电影 这类"推荐位"用的节点，
 *                        类名和普通卡完全不同，之前一直没被扫到，这正是
 *                        "每行末尾带角标的那张怎么都过滤不掉"的真正原因。
 */
const CARD_SELECTOR = '.feed-card, .bili-video-card, .bili-live-card, .floor-single-card'

/** 判定缓存：卡片被 Vue 复用、内容变了要重判，用指纹校验 */
const typeCache = new WeakMap<Element, { sig: string; type: FeedType }>()

/** PGC 六类：只有这几类勾了才需要去查 season 接口，否则一个请求都不发 */
const PGC_TYPES: FeedType[] = ['bangumi', 'movie', 'doc', 'guochuang', 'tv', 'variety']
let needPgcResolution = false

/**
 * 类名不认识、但被"网格兄弟"规则认出来的卡片（首页 PGC 卡就是这种）。
 * 记住它们，后续每轮直接纳入，不再依赖尺寸判断。
 */
const extraCards = new Set<HTMLElement>()

/**
 * 找到"真正占格子"的那一层。
 *
 * 首页网格是 `div.container.is-version8 { display: grid }`，里面每张卡外面还包了
 * 一层 `.bili-feed-card` / `.feed-card`。只隐藏里面的 `.bili-video-card` 时，
 * 外层包装仍然占着 241×227 的格子 —— 页面上就是"过滤掉了，但原位空着一个洞"。
 *
 * 所以往上爬：只要父节点是纯包装（display 不是 grid/flex、里面只有这一张卡），
 * 就把它算进隐藏范围；一遇到网格 / 弹性容器就停，因为再往上就是整片布局了。
 */
function slotOf(card: HTMLElement): HTMLElement {
  let el: HTMLElement = card
  for (let i = 0; i < 4; i += 1) {
    const parent = el.parentElement
    if (!parent || parent === document.body || parent === document.documentElement) {
      break
    }
    const display = getComputedStyle(parent).display
    // 父节点本身是网格/弹性容器 → 当前 el 已经是格子，不能再往上
    if (
      display === 'grid' ||
      display === 'flex' ||
      display === 'inline-grid' ||
      display === 'inline-flex'
    ) {
      break
    }
    // 父节点里还有别的卡片 → 那是公共容器，隐藏它会连带干掉别的卡
    if (parent.querySelectorAll(CARD_SELECTOR).length > 1) {
      break
    }
    el = parent
  }
  return el
}

function hideCard(card: HTMLElement): void {
  const slot = slotOf(card)
  // 只在第一次隐藏时记录原值，重复调用不会把 'none' 记成原值
  if (!slot.hasAttribute(ATTR)) {
    slot.setAttribute(DISPLAY_ATTR, slot.style.getPropertyValue('display'))
  }
  slot.setAttribute(ATTR, '1')
  // B 站卡片常带 `display:...!important`，属性选择器压不住，补内联
  slot.style.setProperty('display', 'none', 'important')
}

/** 恢复"占格子的那一层"（属性挂在格子上，不挂在卡片上） */
function restoreSlot(slot: HTMLElement): void {
  const original = slot.getAttribute(DISPLAY_ATTR) ?? ''
  slot.removeAttribute(ATTR)
  slot.removeAttribute(DISPLAY_ATTR)
  // 原值就是 none 时不还原成 none —— 那多半是 B 站自己的 v-show 残留，
  // 还原成 none 会把卡片永久钉死（这正是"普通推荐全部没了"的一个来源）。
  if (original && original !== 'none') {
    slot.style.setProperty('display', original)
  } else {
    slot.style.removeProperty('display')
  }
}

/** 这张卡是否已被隐藏（判断它占格子的那一层） */
function isHidden(card: HTMLElement): boolean {
  return slotOf(card).hasAttribute(ATTR)
}

function collectCards(): HTMLElement[] {
  const all = Array.from(document.querySelectorAll<HTMLElement>(CARD_SELECTOR))
  // 只留最外层：.feed-card 里套着 .bili-video-card，隐藏外层即可。
  // 用 closest 判祖先，O(n)；别用 all.some(other.contains(el)) 那种 O(n²)，
  // 首页滚动时每帧都要跑一遍。
  const top = all.filter(el => !el.parentElement?.closest(CARD_SELECTOR))

  const out: HTMLElement[] = []
  for (const el of top) {
    const nested = el.querySelectorAll<HTMLElement>(CARD_SELECTOR)
    if (nested.length >= 2) {
      /*
       * 这一层里套着 2 张以上卡片，说明它是"整块容器"（一整列、甚至整个推荐区）。
       * 直接隐藏它 = 整片推荐流瞬间清空，而报告里仍然能数到里面所有卡片，
       * 现象就是"卡片数量正常，但一张都看不见"。
       * 改成展开成最内层卡片，逐个判定。
       */
      nested.forEach(child => {
        if (!child.querySelector(CARD_SELECTOR)) {
          out.push(child)
        }
      })
    } else {
      out.push(el)
    }
  }

  /*
   * 兜底：按"网格兄弟"补齐未知卡片类型。
   *
   * PGC 卡（番剧/电影/纪录片/国创/电视剧/综艺，链接 `/bangumi/play/ep|ss…`）
   * 在首页用的是另一套容器，类名既不是 `.feed-card` 也不是 `.bili-video-card`，
   * 于是从来没进过扫描结果 —— 表现就是"每行带角标的卡怎么都过滤不掉，
   * 而报告里 72 张全是 video"。
   *
   * 卡片总是和已知卡片并排放在同一个网格里，所以把"已知卡片的兄弟节点"也纳入。
   * 判据：不含已知卡片、**宽度和已知卡片相近**（差 ≤30%）——第二条很关键，
   * 否则侧边栏、推荐位里那些带 `/bangumi/` 链接的模块也会被当成卡片。
   */
  const seen = new Set<HTMLElement>(out)
  // 已经认出来的额外卡片：后续 apply 不再重复做尺寸判断
  // （卡片被隐藏后 offsetWidth 变 0，再用尺寸筛会把它漏掉 → 反复隐显抖动）
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
        /*
         * 三条几何判据缺一不可，否则会把轮播壳 / 侧栏模块当成卡片：
         *   1) 同一行（offsetTop 差 ≤8px）
         *   2) 宽度差 ≤10%（PGC 卡和普通卡同宽）
         *   3) 高度差 ≤30%（高度不一样的通常是横幅 / 侧栏）
         * 再加"必须有图、内容链接不超过 4 个"，排除整块容器。
         */
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

  /*
   * PGC：`/bangumi/play/ss{id}` 的卡片可能是番剧 / 电影 / 纪录片 / 国创 /
   * 电视剧 / 综艺，推荐流接口里六者完全同构，只有 season 接口能分辨。
   * 解析前按「番剧」先处理，**并且不写缓存** —— 否则解析回来也会被缓存挡住；
   * 解析结果由监听器触发一次 apply 自动纠正。
   */
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
function buildOptions(): Record<string, OptionMetadata> {
  const options: Record<string, OptionMetadata> = {}
  TYPES.forEach(type => {
    options[`hide_${type.key}`] = {
      defaultValue: false,
      displayName: `过滤 · ${type.label}`,
    }
  })
  return options
}

/**
 * 一行式诊断：类型计数 + 每张卡片的判定依据（含所有 ≤6 字短文本）。
 */
function buildReport(limit = 10): string {
  const cards = collectCards()
  const counts: Record<string, number> = {}
  cards.forEach(card => {
    const type = typeOf(card)
    counts[type] = (counts[type] ?? 0) + 1
  })
  const head = `卡片 ${cards.length} 张：${Object.entries(counts)
    .map(([k, v]) => `${k}=${v}`)
    .join(' / ')}`
  // 词汇表：角标若是图片/伪元素，只有这里能看出线索
  const words = `词汇：${vocab(50).join(',')}`
  const struct = `结构：${structHints(24).join(',')}`
  // 骨架屏卡片（无链接）对诊断没意义，跳过
  const rows = cards
    .filter(card => card.querySelector('a[href]'))
    .slice(0, limit)
    .map((card, i) => {
      const info = explain(card)
      return (
        `[${i + 1}] ${info.type} | href=${String((info.hrefs as string[])[0] ?? '').slice(0, 60)}` +
        ` | badge=${info.badge || '-'} | shorts=${shortTexts(card, 6).join(',')}`
      )
    })
  const text = [head, words, struct, ...rows].join('\n')
  console.log(`[首页推荐过滤]\n${text}`)
  return text
}

let reapply: (() => void) | null = null
let dispose: (() => void) | null = null

const component: ComponentMetadata = {
  name: NAME,
  displayName: '首页推荐过滤',
  description:
    '按类型隐藏首页推荐流里的卡片：直播、番剧（含未识别 PGC）、纪录片、电影、国创、' +
    '综艺、电视剧、课程、广告。默认全部关闭，勾选哪类就隐藏哪类；判定不出的卡片一律保留。',
  author: { name: 'local', link: 'https://github.com/the1812/Bilibili-Evolved' },
  tags: [
    {
      name: 'utils',
      displayName: '工具',
      color: '#A36FFD',
      icon: 'mdi-filter-variant',
      order: 6,
    },
  ],
  enabledByDefault: true,
  options: buildOptions(),
  instantStyles: [
    {
      name: 'bhf-feed-hidden',
      style: '[data-bhf-hidden]{display:none!important}',
    },
  ],

  entry(context) {
    const { settings, coreApis } = context
    let observer: MutationObserver | null = null
    let rafId = 0
    let timers: number[] = []
    let lastHidden = -1
    let lastMissing = -1

    const apply = (): void => {
      const opts = settings.options ?? {}
      // 只有勾了 PGC 六类中的任意一类，才值得去查 season 接口
      needPgcResolution = PGC_TYPES.some(t => opts[`hide_${t}`] === true)
      const cards = collectCards()
      const counts: Record<string, number> = {}
      /** 本轮判定为"该隐藏"的卡片 —— 对账的唯一依据 */
      /** 本轮该隐藏的"格子"——对账的唯一依据（属性挂在格子上，不挂卡片上） */
      const keepSlots = new Set<Element>()
      let hidden = 0

      cards.forEach(card => {
        const type = typeOf(card)
        counts[type] = (counts[type] ?? 0) + 1
        // 'video'（含判定不出）永远不隐藏
        const shouldHide = type !== 'video' && opts[`hide_${type}`] === true
        if (shouldHide) {
          keepSlots.add(slotOf(card))
          if (!isHidden(card)) {
            hideCard(card)
          }
          hidden += 1
        }
      })

      /*
       * 对账：文档里还带标记、但本轮不在 keep 里的节点，一律恢复。
       * 这是"永不卡死"的保证：卡片被 Vue 复用、被移出扫描范围、选项刚被关掉，
       * 都能自动复原，不会留下一个永久 display:none 的坑（用户看到的就是
       * "数量还在，但整片推荐流是空的"）。
       */
      document.querySelectorAll<HTMLElement>(`[${ATTR}]`).forEach(slot => {
        if (!keepSlots.has(slot)) {
          restoreSlot(slot)
        }
      })

      // 滚动时 apply 每帧都跑，只在数量变化时打印，避免刷屏
      if (hidden !== lastHidden) {
        lastHidden = hidden
        console.debug(`[首页推荐过滤] 当前隐藏 ${hidden} / ${cards.length} 张卡片`)
      }

      // 全被隐藏 —— 大概率是判定规则又误伤了，必须留下痕迹
      if (cards.length > 0 && hidden === cards.length) {
        console.warn('[首页推荐过滤] 本轮把全部卡片都隐藏了，判定可能误伤：', counts)
      }

      /*
       * 勾了却没命中时只写 console，不再往页面上叠加任何元素。
       * 需要完整依据时手动跑 __bhf__.report() / __bhf__.left() / __bhf__.grid()。
       */
      const missing = TYPES.filter(t => opts[`hide_${t.key}`] === true && !counts[t.key])
      if (missing.length > 0 && missing.length !== lastMissing) {
        lastMissing = missing.length
        const detail = Object.entries(counts)
          .sort((a, b) => b[1] - a[1])
          .map(([k, v]) => `${k}=${v}`)
          .join(' / ')
        console.info(
          `[首页推荐过滤] 勾选了「${missing.map(t => t.label).join('」「')}」但没有命中；当前识别：${detail || '无卡片'}`
        )
      }
    }

    apply()

    // PGC 子类型是异步查出来的，查到后立刻重跑一轮，把该隐藏的补上
    setSeasonResolvedListener(() => apply())

    // 首页推荐是无限滚动 + 骨架屏替换，DOM 一直在变；rAF 节流避免抖动
    observer = new MutationObserver(() => {
      if (rafId) {
        return
      }
      rafId = requestAnimationFrame(() => {
        rafId = 0
        apply()
      })
    })
    if (document.body) {
      observer.observe(document.body, { childList: true, subtree: true })
    }

    // 首屏推荐接口返回比脚本执行晚，补两次
    timers = [600, 1500].map(ms => window.setTimeout(apply, ms))

    coreApis.settings.addSettingsChangeListener(
      `userComponents.${NAME}.settings.options`,
      () => apply(),
      true
    )

    reapply = apply
    dispose = (): void => {
      if (observer) {
        observer.disconnect()
        observer = null
      }
      if (rafId) {
        cancelAnimationFrame(rafId)
        rafId = 0
      }
      timers.forEach(id => window.clearTimeout(id))
      timers = []
      document.querySelectorAll<HTMLElement>(`[${ATTR}]`).forEach(restoreSlot)
    }

    console.info(`[首页推荐过滤] v${VERSION} 已加载`)
  },

  reload() {
    reapply?.()
  },

  unload() {
    dispose?.()
  },
}

export { component }

/* ==================== 控制台调试入口 ==================== */

try {
  // BE 沙箱注入 unsafeWindow；在普通页面（自测）里退回 window
  const dbgWindow = (typeof unsafeWindow !== 'undefined' ? unsafeWindow : window) as Window & {
    __bhf__?: unknown
  }
  dbgWindow.__bhf__ = {
    /** 当前运行的版本号 —— 排查"改了没生效"第一步就是看它 */
    version: VERSION,
    /** 各类型卡片数量，用来确认判定是否正确 */
    scan: () => {
      const counts: Record<string, number> = {}
      collectCards().forEach(card => {
        const type = typeOf(card)
        counts[type] = (counts[type] ?? 0) + 1
      })
      return counts
    },
    /** 手动重新应用 */
    apply: () => (reapply ? reapply() : '组件未运行'),
    /** 当前被隐藏的卡片（元素引用） */
    hidden: () => Array.from(document.querySelectorAll(`[${ATTR}]`)),
    /**
     * 运行态快照 —— 「卡片还在但看不见」时先看这个。
     * total 是扫描到的卡片数，hidden 是被我们隐藏的，visible 是真正有尺寸的；
     * 三个数一对不上，就知道是判定错了还是恢复没生效。
     */
    state: () => {
      const cards = collectCards()
      const byType: Record<string, number> = {}
      let hidden = 0
      let visible = 0
      cards.forEach(card => {
        const type = typeOf(card)
        byType[type] = (byType[type] ?? 0) + 1
        if (isHidden(card)) {
          hidden += 1
          return
        }
        const rect = card.getBoundingClientRect()
        if (rect.width > 0 && rect.height > 0) {
          visible += 1
        }
      })
      return {
        total: cards.length,
        hidden,
        visible,
        byType,
        /** 文档里所有带隐藏标记的节点数（含已不在扫描范围内的） */
        marked: document.querySelectorAll(`[${ATTR}]`).length,
      }
    },
    /** 一键恢复所有被隐藏的卡片，用于排查"怎么都回不来" */
    reset: () => {
      const marked = Array.from(document.querySelectorAll<HTMLElement>(`[${ATTR}]`))
      marked.forEach(restoreSlot)
      return `已恢复 ${marked.length} 张卡片`
    },
    /** PGC 子类型解析状态：resolved 是已缓存的 season 数，disabled 表示接口不可用 */
    pgc: () => seasonStats(),
    /**
     * 结构诊断：看一眼"网格里每张卡到底是什么节点"。
     * 每一行 `缩进 类名 | 宽x高 | 链接前缀`，能直接看出有没有卡片没被扫描到。
     */
    grid: (limit = 16) => {
      const first = document.querySelector<HTMLElement>(CARD_SELECTOR)
      const lines: string[] = []
      if (!first) {
        return '页面上没找到已知卡片'
      }
      let node: HTMLElement = first
      for (let depth = 0; depth < 3 && node.parentElement; depth += 1) {
        const parent = node.parentElement
        lines.push(
          `── 祖先 ${depth + 1} <${parent.tagName.toLowerCase()} class="${String(parent.className).slice(0, 40)}"> ${parent.children.length} 个子节点`
        )
        Array.from(parent.children)
          .slice(0, limit)
          .forEach(child => {
            const el = child as HTMLElement
            const href = el.querySelector('a[href]')?.getAttribute('href') ?? ''
            const mark = collectCards().includes(el) ? '✓' : '·'
            lines.push(
              `  ${mark} ${String(el.className).slice(0, 44) || '(no class)'} | ${el.offsetWidth}x${el.offsetHeight} | ${href.slice(0, 38)}`
            )
          })
        node = parent
      }
      const text = lines.join('\n')
      console.log(text)
      try {
        void navigator.clipboard?.writeText(text)
      } catch {
        // 剪贴板被拒就只用 console
      }
      return text
    },
    left: (limit = 12) => {
      const rows = collectCards()
        .filter(
          card =>
            !isHidden(card) &&
            card.querySelector('a[href]') &&
            card.getBoundingClientRect().height > 0
        )
        .slice(0, limit)
        .map(card => {
          const href = card.querySelector('a[href]')?.getAttribute('href') ?? ''
          return `[${typeOf(card)}] ${cornerText(card) || '-'} | ${href.slice(0, 42)}`
        })
      const text = `剩余可见 ${rows.length} 张：\n${rows.join('\n')}`
      console.log(text)
      try {
        void navigator.clipboard?.writeText(text)
      } catch {
        // 剪贴板被拒就只用 console
      }
      return text
    },
    /**
     * 判定依据摊开：每张卡片的 className / 属性 / 角标文字 / 前几个链接 / 最终类型。
     * 过滤不生效时先看这个 —— 能直接看出是"没扫到卡片"、"角标没命中"还是"链接没命中"。
     */
    inspect: (limit = 6) =>
      collectCards()
        .slice(0, limit)
        .map(card => explain(card)),
    /**
     * 自检：用 B 站真实类名（来自线上 CSS）拼出各类卡片，验证判定链路。
     * 全绿 = 判定逻辑没问题，问题在"卡片样式与线上不一致"或"跑的不是这份构建"。
     */
    selftest: () => {
      const cases: Array<{ name: string; html: string; want: string }> = [
        {
          name: '直播(链接)',
          html: '<div class="feed-card"><a href="//live.bilibili.com/123"><img></a></div>',
          want: 'live',
        },
        {
          name: '直播(feed-badge)',
          html:
            '<div class="feed-card"><a href="//www.bilibili.com/video/BV1"><img></a>' +
            '<div class="bili-video-card__mask"><div class="bili-video-card__stats--right">' +
            '<div class="feed-badge"><i class="living-icon"></i><span>直播中</span></div></div></div></div>',
          want: 'live',
        },
        {
          name: '综艺(icon-text)',
          html:
            '<div class="feed-card"><a href="//www.bilibili.com/bangumi/play/ep1"><img></a>' +
            '<div class="bili-video-card__info--tit">' +
            '<span class="bili-video-card__info--icon-text">综艺</span><span>某综艺 第二季</span></div></div>',
          want: 'variety',
        },
        {
          name: '番剧(icon-text)',
          html:
            '<div class="feed-card"><a href="//www.bilibili.com/bangumi/play/ep2"><img></a>' +
            '<div class="bili-video-card__info--tit">' +
            '<span class="bili-video-card__info--icon-text">番剧</span><span>某番剧</span></div></div>',
          want: 'bangumi',
        },
        {
          name: '课堂(cheese)',
          html: '<div class="feed-card"><a href="//www.bilibili.com/cheese/play/ss1"><img></a></div>',
          want: 'cheese',
        },
        {
          name: '广告(cm链接)',
          html: '<div class="bili-video-card is-rcmd"><a href="//cm.bilibili.com/x"><img></a></div>',
          want: 'ad',
        },
        {
          // 回归用例：is-rcmd 是所有推荐卡都带的类，绝不能当广告
          name: '普通投稿(is-rcmd)',
          html: '<div class="bili-video-card is-rcmd"><a href="//www.bilibili.com/video/BV1aa"><img></a></div>',
          want: 'video',
        },
        {
          // 回归用例：作者名里带"电影"不能被判成电影
          name: '作者名带「电影」',
          html:
            '<div class="feed-card"><a href="//www.bilibili.com/video/BV1bb"><img></a>' +
            '<span class="bili-video-card__info--author">电影迷小雅</span></div>',
          want: 'video',
        },
        {
          // 回归用例：PGC 角标就叠在封面左下角，和播放量同一个 stats 容器
          name: '番剧(封面角标 stats)',
          html:
            '<div class="bili-video-card is-rcmd"><a href="//www.bilibili.com/video/BV1cc"><img></a>' +
            '<div class="bili-video-card__mask"><div class="bili-video-card__stats">' +
            '<div class="bili-video-card__stats--left">' +
            '<div class="bili-video-card__stats--item">' +
            '<span class="bili-video-card__stats--text">番剧</span></div>' +
            '<div class="bili-video-card__stats--item">' +
            '<span class="bili-video-card__stats--text">1234</span></div>' +
            '</div></div></div></div>',
          want: 'bangumi',
        },
        {
          // 楼层卡：真正的类名是 .floor-single-card，角标文字在 .badge > .floor-title
          name: '楼层卡·综艺(badge)',
          html:
            '<div class="floor-single-card"><a href="//www.bilibili.com/bangumi/play/ep1"><img></a>' +
            '<div class="badge"><span class="floor-title">综艺</span></div></div>',
          want: 'variety',
        },
        {
          name: '楼层卡·漫画(manga 链接)',
          html:
            '<div class="floor-single-card"><a href="//manga.bilibili.com/detail/mc1"><img></a>' +
            '<div class="badge"><span class="floor-title">漫画</span></div></div>',
          want: 'manga',
        },
        {
          name: '普通投稿',
          html: '<div class="feed-card"><a href="//www.bilibili.com/video/BV1xx"><img></a></div>',
          want: 'video',
        },
      ]
      return cases.map(({ name, html, want }) => {
        const box = document.createElement('div')
        box.innerHTML = html
        const card = box.firstElementChild as Element
        const got = classify(card)
        return { name, want, got, ok: got === want }
      })
    },
    /** 一行式诊断（含类型计数 + 每张卡片依据），并尝试写入剪贴板 */
    report: (limit = 10) => {
      const text = buildReport(limit)
      try {
        void navigator.clipboard?.writeText(text)
      } catch {
        // 剪贴板被拒就只用 console
      }
      return text
    },
  }
} catch {
  // 非用户脚本环境忽略
}
