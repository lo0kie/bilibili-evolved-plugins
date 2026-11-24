import type { OptionMetadata } from '@/components/types'
import type { TopbarItem } from './types'
import { cssAttrValue } from '@/core/util'

/** 顶栏根容器，兼容国际版 */
const SCOPE = ':is(.bili-header, .international-header)'

const SEARCH_BASE_WIDTH = 500
const SEARCH_MIN_WIDTH = 181

/* ==================== 控件隐藏 ==================== */

/**
 * 任何隐藏规则都不许落在含头像的元素上。
 * `.header-avatar-wrap` 自己带 right-entry__item 类名，弹层里还有一堆 space / member
 * 链接，很容易被别的项的 :has() 规则连带命中 —— 一旦命中就是整块头像凭空消失。
 */
const KEEP_AVATAR = ':not(.header-avatar-wrap):not(:has(.header-avatar-wrap))'

/**
 * 顶栏下滑时会切换成 mini 结构，节点被重建，只靠 data 属性必然闪一帧。
 * 这里用 CSS 选择器直接命中链接，与 DOM 是否重建无关，生效瞬间无延迟。
 * :has() 不支持时规则会被浏览器忽略，属性方案仍然兜底。
 */
export function buildHiddenCss(hidden: TopbarItem[]): string {
  const rules: string[] = []
  let needLogoRule = false

  hidden.forEach(item => {
    if (item.logo) {
      needLogoRule = true
      return
    }
    if (!item.href || !item.hrefOp) {
      return
    }
    const match = `a[href${item.hrefOp}"${cssAttrValue(item.href)}"]`
    // 排除 Logo 项：它和"首页"共用同一个链接，不能连带隐藏
    const notLogo = ':not(:has([class*="logo"]))'
    /*
     * 排除头像：`.header-avatar-wrap` 本身也带 right-entry__item 类名，
     * 且它的弹层里有 space / member 等一堆链接，只要有一个被关掉的项
     * 的链接落在里面，这条 :has() 规则就会连带把整块头像 display:none。
     * 这条规则是**静态**的，一旦命中就是全状态消失，和"配置误绑"的表现几乎一样，
     * 必须一起封掉。
     */
    // 1. 链接的直接父级（常规结构）
    rules.push(`${SCOPE} :has(> ${match})${notLogo}${KEEP_AVATAR}`)
    // 2. 限定在"顶栏项"上的后代匹配（mini 结构多包一层时兜底）
    rules.push(`${SCOPE} [class*="entry__item"]:has(${match})${notLogo}${KEEP_AVATAR}`)
  })

  if (needLogoRule) {
    // Logo 是 .big-logo（Vue 组件，链接与首页相同），直接命中元素本身最稳
    rules.push(`${SCOPE} .big-logo`)
    rules.push(`${SCOPE} [class*="entry__item"]:has([class*="logo"])${KEEP_AVATAR}`)
  }

  return rules.length > 0 ? `${rules.join(',')}{display:none!important}` : ''
}

/* ==================== 间距 / 其它选项 ==================== */

/**
 * 实测 B 站顶栏结构：
 *   .bili-header__menu  display:flex; justify-content:space-between
 *     .left-entry.menu-left                flex-shrink:0
 *     .center-search-container.menu-center flex-grow:1; margin:0 50px
 *       .center-search__bar                margin:0 auto; min-width:181px; max-width:500px
 *     .right-entry.menu-right
 *
 * 按钮间距 = 每项的 margin-right（左 10px，右 8px）
 * 区域间距：改 .menu-center 的 margin 无效（flex-grow 吃满 + 内部居中），
 *          必须改搜索框宽度与顶栏 padding。
 */
export const GAP_OPTIONS: Record<string, OptionMetadata> = {
  gapItems: {
    defaultValue: -1,
    displayName: '按钮之间的间距 (-1 = 默认)',
    slider: { min: -1, max: 40, step: 1 },
  },
  gapGroups: {
    defaultValue: -1,
    displayName: '按钮区之间的间距 (-1 = 默认)',
    slider: { min: -1, max: 80, step: 1 },
  },
}

export const MISC_OPTIONS: Record<string, OptionMetadata> = {
  showAdblockTip: {
    defaultValue: true,
    displayName: '显示「插件影响」提示条',
  },
  showFixedChannel: {
    defaultValue: true,
    displayName: '显示滚动时固定的分区栏',
  },
  showTopbarAnimation: {
    defaultValue: true,
    displayName: '顶栏显隐动画',
  },
  pinHeader: {
    defaultValue: true,
    displayName: '顶栏常驻顶部（无滑入滑出）',
  },
  alignRightEdge: {
    defaultValue: true,
    displayName: '左右边缘对齐（只移动左侧，右侧不动）',
  },
}

function toGap(value: unknown): number | null {
  const n = Number(value)
  if (!Number.isFinite(n) || n < 0) {
    return null
  }
  return Math.round(n)
}

function buildGapCss(opts: Record<string, unknown>): string {
  const rules: string[] = []
  const items = toGap(opts.gapItems)
  const groups = toGap(opts.gapGroups)

  if (items !== null) {
    rules.push(`${SCOPE} .left-entry .left-entry__item{margin-right:${items}px!important}`)
    rules.push(`${SCOPE} .left-entry .left-entry__item:last-child{margin-right:0!important}`)
    rules.push(`${SCOPE} .right-entry .right-entry__item{margin-right:${items}px!important}`)
    rules.push(`${SCOPE} .right-entry .right-entry__item:last-child{margin-right:0!important}`)
  }

  if (groups !== null) {
    // 一个滑杆同时控制三处：边缘 padding、flex gap、搜索框宽度
    const width = Math.max(SEARCH_MIN_WIDTH, SEARCH_BASE_WIDTH - groups * 2)
    /*
     * 注意：`.bili-header__menu` 和 `.bili-header__bar` 是**同一个 div**
     * （class="bili-header__menu is-zh bili-header__bar"），padding 必须打在这个盒子上。
     * 早期只写 `.bili-header__menu`，遇到内联 padding-left 就整条失效。
     */
    rules.push(
      `${SCOPE} :is(.bili-header__bar, .bili-header__menu){display:flex!important;align-items:center!important;` +
        `justify-content:space-between!important;gap:${groups}px!important;` +
        `padding-left:${groups}px!important;padding-right:${groups}px!important}`
    )
    // 原本 margin:0 50px 会和 gap 叠加，归零
    rules.push(
      `${SCOPE} .bili-header__menu .menu-center{margin-left:0!important;margin-right:0!important}`
    )
    rules.push(`${SCOPE} .center-search__bar{max-width:${width}px!important}`)
  }
  return rules.join('\n')
}

/** 滚动时顶栏的出现/消失动画 */
const ANIMATION_SELECTOR = '.bili-header.bili-header--slide-down .bili-header__bar, .header-channel'

function buildMiscCss(opts: Record<string, unknown>): string {
  const rules: string[] = []

  /*
   * ============ 头像：只管尺寸，不管可见性 ============
   *
   * 真实结构（index-a5f8e5ab.js 原文）：
   *
   *   <div class="header-avatar-wrap--container mini-avatar--init|small|large">
   *     <a class="header-entry-mini"><VImg src=face width=60 height=60 /></a>
   *     <a class="header-entry-avatar"></a>   ← 空的，children 就是 null
   *   </div>
   *
   * 头像只有一份真身（.header-entry-mini 里的 VImg）；.header-entry-avatar 是空热区。
   * showPopover: 0=init 1=small 2=large。状态 2（悬停/弹层打开）下 B 站给真身挂
   * fadeOut（终态 opacity:0），由弹层里那个 80px 的 .big-avatar 接管 —— 这是
   * **B 站原生交互**：小头像淡出、放大版出现。之前把可见性钉死，两版叠在一起，
   * 就变成"hover 放大时原位多了一个"。
   *
   * 所以这里只保留尺寸约束：图固定 38px 正圆（B 站给 VImg 传的是 60×60，
   * 靠容器裁剪看着才正好；写死尺寸后不会溢出、也不会在缩放时抖）。
   * 可见性一律交还 B 站，只有 buildAvatarKeepCss 里那条"反误伤"的保底规则，
   * 且明确排除 --large 态。
   */
  const MINI = `${SCOPE} .header-avatar-wrap--container`
  rules.push(
    `${MINI} .header-entry-mini .v-img,${MINI} .header-entry-mini img{` +
      `width:38px!important;height:38px!important;` +
      `box-sizing:border-box!important;object-fit:cover!important;border-radius:50%!important}`
  )

  // 插件影响提示条（B 站检测到 AdBlock 时渲染的橙色条）
  if (opts.showAdblockTip === false) {
    rules.push('.adblock-tips{display:none!important}')
  }

  // 滚动时浮出的固定分区栏（外层才是 fixed + 背景 + 阴影）
  if (opts.showFixedChannel === false) {
    rules.push('.header-channel{display:none!important}')
  }

  if (opts.pinHeader !== false) {
    /*
     * 直接钉在视口顶部：没有"进入/退出"状态，也就没有位移动画。
     * 背景用 ::after 蒙版做 opacity 渐变 —— B 站是在 --mini/--fixed 上直接换
     * background 简写（含渐变），CSS 无法在渐变之间插值，只能瞬间跳变。
     */
    const bar = '.bili-header__bar'
    const states = ['--mini', '--fixed', '--slide-down']
    const pinned = states.map(s => `${SCOPE}.bili-header${s} ${bar}`).join(',')
    // 每个选择器都要单独带 ::after
    const pinnedAfter = states.map(s => `${SCOPE}.bili-header${s} ${bar}::after`).join(',')

    rules.push(
      `${SCOPE} ${bar}{position:fixed!important;top:0!important;` +
        // left/right + auto margin：宽度受 max-width 限制时居中，否则右侧会多出一整块空白
        `left:0!important;right:0!important;margin-left:auto!important;margin-right:auto!important;` +
        `animation:none!important;z-index:1002!important}`
    )
    rules.push(
      `${SCOPE} ${bar}::after{content:'';position:absolute;inset:0;z-index:-1;` +
        `background:var(--bg1_float);opacity:0;pointer-events:none;` +
        `transition:opacity .3s ease,box-shadow .3s ease}`
    )
    // 滚动状态：背景交给蒙版
    rules.push(`${pinned}{background:transparent!important;box-shadow:none!important}`)
    rules.push(`${pinnedAfter}{opacity:1;box-shadow:0 2px 4px rgba(0,0,0,.08)}`)
  }

  if (opts.showTopbarAnimation === false) {
    rules.push(`${ANIMATION_SELECTOR}{animation:none!important;transition:none!important}`)
  }

  return rules.join('\n')
}

/* ==================== 头像保活（最后一条，最高优先级） ==================== */

/**
 * 头像"反误伤"保底：只对付**我们自己的隐藏规则**可能命中的情况，
 * 而且明确排除 hover 放大态（`mini-avatar--large`）——
 * 那个状态下 B 站要让小头像淡出、由弹层里的 80px 大头像接管，
 * 一旦在这里钉住可见性，就会出现"原位多了一个"。
 *
 * `:not(#bhc-keep)` 是个纯特异性放大器：页面上不存在这个 id，选择器永远匹配，
 * 但凭空多一个 (1,0,0)，能压过任何不带 id 的规则，也不依赖注入顺序。
 * 内联 `!important` 压不住，由 protectAvatar() 在运行期清除。
 */
function buildAvatarKeepCss(): string {
  return (
    `${SCOPE} .header-avatar-wrap:not(#bhc-keep):not(:has(.mini-avatar--large)){` +
    `display:block!important;visibility:visible!important}`
  )
}

/* ==================== 左右对称（常驻） ==================== */

/**
 * B 站靠 `.right-entry__item:last-child { margin-right: 0 }` 把右侧最后一项贴到边缘。
 * 但 .right-entry 末尾经常留着一个占位节点（right-entry__loading 之类），
 * 于是最后一项不再是 :last-child，那 8px margin 留在原地 ——
 * 右侧到屏幕边缘就比左侧多 8px（左侧第一项没有 margin-left，天然贴边）。
 *
 * :nth-last-child(1 of .right-entry__item) 直接锁定"最后一个项"，不受占位节点影响。
 * 两条拆开写：老浏览器不认识 `of S` 语法时只会丢掉第二条，:last-child 那条仍然生效。
 */
const ALIGN_RULES = [
  `${SCOPE} .right-entry .right-entry__item:last-child{margin-right:0!important}`,
  `${SCOPE} .right-entry .right-entry__item:nth-last-child(1 of .right-entry__item){margin-right:0!important}`,
  `${SCOPE} .left-entry .left-entry__item:first-child{margin-left:0!important}`,
]

export function buildAlignCss(): string {
  return ALIGN_RULES.join('\n')
}

/* ==================== 样式注入 ==================== */

let styleEl: HTMLStyleElement | null = null
let lastCss: string | null = null

export function buildStyleCss(hidden: TopbarItem[], opts: Record<string, unknown>): string {
  return [
    buildHiddenCss(hidden),
    buildGapCss(opts),
    buildMiscCss(opts),
    buildAlignCss(),
    // 必须最后：头像保活要压过上面所有可能命中它的规则
    buildAvatarKeepCss(),
  ]
    .filter(Boolean)
    .join('\n')
}

export function updateStyleCss(hidden: TopbarItem[], opts: Record<string, unknown>): void {
  const css = buildStyleCss(hidden, opts)
  if (css === lastCss) {
    return
  }
  lastCss = css
  if (!styleEl || !styleEl.isConnected) {
    styleEl = document.createElement('style')
    styleEl.id = 'bhc-topbar-dynamic'
    ;(document.head ?? document.documentElement).appendChild(styleEl)
  }
  styleEl.textContent = css
}

export function removeStyleCss(): void {
  lastCss = null
  if (styleEl?.parentNode) {
    styleEl.parentNode.removeChild(styleEl)
  }
  styleEl = null
}
