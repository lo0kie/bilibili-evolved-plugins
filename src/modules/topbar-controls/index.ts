import { clearCache, mergeItems, readCache, saveCache } from './cache'
import { isAccountItem, scanNow } from './scan'
import { GAP_OPTIONS, MISC_OPTIONS, removeStyleCss, updateStyleCss } from './styles'
import type { ComponentMetadata, OptionMetadata } from '../../shared/types'
import type { CachedItem, TopbarItem } from './types'

/**
 * BE 的代码沙箱是 `with (window) { eval(code) }`，且 with 对象的 has 恒为 true，
 * 顶层标识符都会被它拦截，所以打包产物必须是一层 IIFE（esbuild 的 iife 格式）。
 * `unsafeWindow` 由沙箱注入；导出走 globalName + footer，见 build.mjs。
 */
declare const unsafeWindow: Window & { __bhc__?: unknown }

const NAME = 'topbarControls'
const VERSION = '3.7.3'
const ATTR = 'data-bhc-hidden'

/**
 * 内联 display 的原始值，卸载时还原。
 * 只靠 `[data-bhc-hidden]{display:none!important}` 属性选择器，
 * 遇到 B 站自带 `display:...!important` 且特异性更高的规则会被压住（投稿等项），
 * 所以同时写内联样式（内联 !important 优先级高于任何外部样式）。
 */
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

/**
 * 右侧"视觉上真正贴边"的位置。
 *
 * 不能直接用 getBoundingClientRect 取最大值：`.right-entry__main`、`.right-entry__item`
 * 这类布局盒子会撑满整行，它们的 right 永远是内容区右边缘，量不出内部的 10px 留白。
 * 所以只取**叶子节点**——图标、文字、头像图片这些实际被画出来的东西。
 */
function rightmostLeafEdge(root: Element): number {
  let edge = Number.NEGATIVE_INFINITY
  const visible = (el: Element): boolean => {
    const rect = el.getBoundingClientRect()
    if (rect.width <= 0 || rect.height <= 0) {
      return false
    }
    const style = getComputedStyle(el)
    // 隐藏的弹层（visibility:hidden / opacity:0）仍有尺寸，必须排除
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

/**
 * 左侧区块的额外位移（px）。只由 normalizeRightInset 测量后写入，
 * 落地到 `.left-entry` 的 margin-left —— 绝不碰 `.bili-header__bar` 的 padding：
 * 那个 padding 归「按钮区之间的间距」滑杆所有，内联 !important 一旦写上去，
 * 样式表里的 padding-left 就永远被压住（滑杆调不动左边缘就是这么来的）。
 */
let alignOffset = 0
/** 记录被我们改过 margin-left 的元素及其原值，撤销时精确还原 */
const savedMargin = new WeakMap<HTMLElement, string>()

function leftEntryEl(): HTMLElement | null {
  const bar = document.querySelector('.bili-header__bar')
  return (bar?.querySelector('.left-entry') as HTMLElement | null) ?? null
}

/** 只写值、不测量。可以在 MutationObserver 链路里反复调用而不会引起布局震荡。 */
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

/** 撤销运行时校准，交还给 B 站 */
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
  // 清理 v3.5.x 遗留的内联 padding（旧实现钉在 bar 上，会把滑杆锁死）
  const bar = document.querySelector('.bili-header__bar') as HTMLElement | null
  bar?.style.removeProperty('padding-left')
  bar?.style.removeProperty('padding-right')
}

/**
 * 左右边缘对齐（运行时实测校准）。
 *
 * 两侧都以**窗口边缘**为基准量，而不是以顶栏盒子：
 *   gapLeft  = 左侧第一个按钮的左边缘
 *   gapRight = innerWidth - 右侧最右"可见叶子"的右边缘
 * 这样滚动条的宽度自动被算进去（固定栏贴的是内容区右边缘，视觉上却多了整条滚动条）。
 *
 * 右侧最后一项的"尾巴"各不相同：投稿按钮自带约 20px 内边距、头像容器内有 10px
 * margin（注意那是头像和"消息"之间的间距，不能归零）、有时还多一个占位节点。
 * 写死选择器追不上，所以直接按"最右可见叶子"实测。
 *
 * 校正量 delta = gapRight - gapLeft，累加进 alignOffset（增量式，收敛后 delta≈0）。
 * 只移动左侧：右侧的触发区、弹层锚点保持原地，悬停头像不会抖动。
 */
function normalizeRightInset(opts?: Record<string, unknown>): void {
  const bar = document.querySelector('.bili-header__bar') as HTMLElement | null
  const left = bar?.querySelector('.left-entry')
  const right = bar?.querySelector('.right-entry')
  if (!bar || !left || !right) {
    return
  }
  // 开关关闭：撤销校准，恢复 B 站原样
  if (opts && opts.alignRightEdge === false) {
    if (alignOffset !== 0) {
      clearAlignOffset()
    }
    return
  }
  // 鼠标正停在右侧（头像弹层打开中）时不要动布局，否则会把 hover 弄丢
  if (typeof right.matches === 'function' && right.matches(':hover')) {
    return
  }
  // 取第一个"可见"的项：被隐藏的项 width 为 0，不能当基准
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
  // 正负都要跟上：滑杆把左边调大后 delta 变负，得能把偏移收回去
  const next = Math.max(-30, Math.min(72, alignOffset + delta))
  if (next === alignOffset) {
    return
  }
  alignOffset = next
  writeAlignOffset()
}

/**
 * 头像保活。
 *
 * 头像挂在 `.header-avatar-wrap` 里，这个节点带 right-entry__item 类名、弹层里还有
 * 一堆 space / member 链接，历史上被两种来源误伤过：
 *   1. `hideEl()` 把某个"项"整体隐藏，而那个项正好是头像容器；
 *   2. `buildHiddenCss` 的 `:has()` 规则命中了它。
 * 两种来源都已经在源头封掉，这里再加一道运行期保险：只要含头像的节点
 * 还挂着我们的隐藏标记或内联 display:none，就地复原。
 * 每次 apply 都会跑，所以旧版本实例残留的写法也会被清掉。
 */
function protectAvatar(): void {
  // hover 放大态：B 站要让小头像淡出、交给弹层里的大头像，这里别抢
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
  options: Record<string, OptionMetadata>
  hasLive: boolean
}

/**
 * BE 的 OptionMetadata 没有分组/分隔线能力（FeatureOptions.vue 是一层平铺 v-for，
 * 只认 hidden 和 extraOptions），所以分类靠"名称前缀 + 排列顺序"实现：
 *   前半段 = 显隐（每个顶栏控件一个开关）
 *   后半段 = 其它（间距、提示条、固定分区栏、常驻顶部…）
 */
const GROUP_SHOW = '显隐'
const GROUP_MISC = '其它'

function groupLabel(group: string, name: string): string {
  return `${group} · ${name}`
}

/** 其它功能统一加前缀，保持和显隐区分开 */
function withGroupPrefix(list: Record<string, OptionMetadata>): Record<string, OptionMetadata> {
  const out: Record<string, OptionMetadata> = {}
  Object.entries(list).forEach(([key, meta]) => {
    out[key] = { ...meta, displayName: groupLabel(GROUP_MISC, meta.displayName ?? key) }
  })
  return out
}

/**
 * 代码执行阶段就生成选项（此时 DOM 可能还没就绪）：
 * 实时扫描优先，扫不到就用上一次的缓存补齐。
 */
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
  // 显隐在前、其它在后，顺序即分组
  Object.assign(options, withGroupPrefix(GAP_OPTIONS), withGroupPrefix(MISC_OPTIONS))

  return { items: merged, options, hasLive: live.length > 0 }
})()

let reapply: (() => void) | null = null
let dispose: (() => void) | null = null

const component: ComponentMetadata = {
  name: NAME,
  displayName: '顶栏控件管理',
  description:
    '选项分两组：「显隐」逐个控制顶栏控件（开启=显示，关闭=隐藏）；' +
    '「其它」是间距、提示条、固定分区栏、常驻顶部等行为设置（间距 -1 = 保持 B 站默认）。',
  author: { name: 'local', link: 'https://github.com/the1812/Bilibili-Evolved' },
  tags: [
    {
      name: 'utils',
      displayName: '工具',
      color: '#A36FFD',
      icon: 'mdi-rocket-launch-outline',
      order: 5,
    },
  ],
  enabledByDefault: true,
  options: bootstrap.options,
  instantStyles: [
    {
      name: 'bhc-topbar-hidden',
      style: '[data-bhc-hidden]{display:none!important}',
    },
  ],

  entry(context) {
    const { settings, metadata, coreApis } = context
    let observer: MutationObserver | null = null
    let rafId = 0
    let applying = false
    let warnedOrphan = false

    const apply = (): void => {
      if (applying) {
        return
      }
      applying = true
      try {
        const live = scanNow()

        // 清理旧标记，防止控件被 React 复用后错位
        restoreAll()

        // 发现新控件：补进 options 并更新缓存
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
          console.info(
            `[顶栏控件管理] 发现 ${discovered} 个新控件，已写入配置，重新打开设置面板即可看到`
          )
        }

        // 只有明确为 false 才隐藏：新增控件在设置里还没有值（undefined），
        // 用 !value 会把它误判成隐藏
        const opts = settings.options ?? {}
        const hidden: TopbarItem[] = []
        const liveKeys = new Set<string>()
        live.forEach(item => {
          const key = `show_${item.key}`
          liveKeys.add(key)
          // 头像（账号入口）永远不参与隐藏：它的 key 随顶栏状态漂移，
          // 一旦绑到被关掉的开关，整个头像会凭空消失（且只在某个状态下消失）
          if (opts[key] === false && !isAccountItem(item.el)) {
            hideEl(item.el)
            hidden.push(item)
          }
        })
        updateStyleCss(hidden, opts)
        // 头像永远不许被隐藏：清掉任何残留的隐藏标记（含旧实例 / 旧样式命中）
        protectAvatar()
        /*
         * 这里只"补写"校准结果，不测量。
         * 顶栏下滑 / hover 会让 B 站重建节点，内联 margin 随之丢失，所以每次 apply 都补一遍；
         * 但测量绝不能放进来 —— 悬停头像 → 弹层 → MutationObserver → apply → 改布局 →
         * 鼠标脱离 → 弹层关闭 → 再触发，来回震荡会把 hover 弄丢。
         */
        writeAlignOffset()

        // 诊断：开关是关的，但当前页面找不到对应控件（key 漂移或控件被移出顶栏）
        const orphan = Object.keys(opts).filter(
          k => k.startsWith('show_') && opts[k] === false && !liveKeys.has(k)
        )
        if (orphan.length > 0 && !warnedOrphan) {
          warnedOrphan = true
          console.warn('[顶栏控件管理] 以下开关已关闭但没匹配到当前控件，可能已失效：', orphan)
        }
      } finally {
        applying = false
      }
    }

    apply()

    // 清掉 v3.5.x 留在 bar 上的内联 padding（旧实现把滑杆的 padding-left 锁死了）
    const headerBar = document.querySelector('.bili-header__bar') as HTMLElement | null
    headerBar?.style.removeProperty('padding-left')
    headerBar?.style.removeProperty('padding-right')

    // 清掉旧版本可能写在头像上的隐藏标记（v3.7.1 起头像不再参与隐藏）
    protectAvatar()

    /*
     * 边缘校准只在这些时机跑：首屏（两次，等字体/头像加载完）、resize、改设置。
     * 放进 MutationObserver 会和 hover 弹层形成震荡，头像会一闪就消失。
     */
    const scheduleAlign = (): void => {
      const current = settings.options ?? {}
      requestAnimationFrame(() => normalizeRightInset(current))
    }
    scheduleAlign()
    window.setTimeout(() => normalizeRightInset(settings.options ?? {}), 600)

    // 用 rAF 代替定时器：顶栏下滑时节点会被重建，越早补上越不容易被看见
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

    // 窗口尺寸变化（含滚动条出现/消失）会改变右边缘，重新校准
    const onResize = (): void => {
      apply()
      scheduleAlign()
    }
    window.addEventListener('resize', onResize)

    // 选项变化时立即重绘（隐藏项会改变右边缘，需要重新校准）
    const onOptionsChange = (): void => {
      apply()
      scheduleAlign()
    }
    coreApis.settings.addSettingsChangeListener(
      `userComponents.${NAME}.settings.options`,
      onOptionsChange,
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
      coreApis.settings.removeSettingsChangeListener(
        `userComponents.${NAME}.settings.options`,
        onOptionsChange
      )
      window.removeEventListener('resize', onResize)
      restoreAll()
      removeStyleCss()
      // 撤销运行时校准，交还给 B 站
      clearAlignOffset()
    }

    console.info(
      `[顶栏控件管理] v${VERSION} 已加载，共 ${bootstrap.items.length} 个控件` +
        (bootstrap.hasLive ? '' : '（来自缓存，等待顶栏渲染）')
    )
  },

  reload() {
    reapply?.()
  },

  unload() {
    dispose?.()
  },
}

// 交给构建脚本: esbuild 以 globalName 暴露成 IIFE 返回值,
// footer 再写入沙箱的 exports（不能在源码里直接写 exports.component，
// 那会让 esbuild 把文件当成 CommonJS 模块包装）。
export { component }

/* ==================== 控制台调试入口 ==================== */

try {
  unsafeWindow.__bhc__ = {
    /** 当前扫描到的控件 */
    scan: () => scanNow().map(({ key, label, side }) => ({ key, label, side })),
    /** 手动重新应用 */
    apply: () => (reapply ? reapply() : '组件未运行'),
    /** 启动时生成的控件清单 */
    items: () => bootstrap.items,
    /** 清空缓存，下次加载重新扫描 */
    clear: () => clearCache(),
    /**
     * 头像现状快照。头像消失时**趁它还空着**执行一次，把输出贴出来即可定位。
     * 覆盖三层可能：节点被移除 / 图片没加载 / 某一层祖先被改成不可见。
     */
    avatar: () => {
      const wrap = document.querySelector('.header-avatar-wrap--container')
      if (!wrap) {
        return '没找到 .header-avatar-wrap--container（头像整块被移除？）'
      }
      const pick = (el: Element | null) => {
        if (!el) {
          return { found: false }
        }
        const rect = el.getBoundingClientRect()
        const s = getComputedStyle(el)
        return {
          cls: String((el as HTMLElement).className ?? '').slice(0, 48),
          box: `${Math.round(rect.width)}x${Math.round(rect.height)}`,
          at: `${Math.round(rect.left)},${Math.round(rect.top)}`,
          display: s.display,
          visibility: s.visibility,
          opacity: s.opacity,
          transform: s.transform,
          animation: s.animationName,
          zIndex: s.zIndex,
          // 关键：隐藏标记 / 内联样式，用来区分"是我们隐藏的"还是"B 站隐藏的"
          hidden: el.hasAttribute(ATTR),
          inline: (el as HTMLElement).getAttribute('style') ?? '',
        }
      }
      const img = wrap.querySelector('.header-entry-mini img') as HTMLImageElement | null
      // 祖先链：任何一层不可见都会让头像凭空消失
      const chain: string[] = []
      let node: Element | null = wrap
      for (let i = 0; i < 5 && node; i += 1) {
        const s = getComputedStyle(node)
        const tag = `${node.tagName.toLowerCase()}.${String((node as HTMLElement).className).split(' ')[0]}`
        chain.push(
          `${tag}{d:${s.display},v:${s.visibility},o:${s.opacity},z:${s.zIndex},h:${node.hasAttribute(ATTR)}}`
        )
        node = node.parentElement
      }
      return {
        wrapClass: (wrap as HTMLElement).className,
        mini: pick(wrap.querySelector('.header-entry-mini')),
        big: pick(wrap.querySelector('.header-entry-avatar')),
        img: img
          ? {
              src: img.currentSrc || img.src,
              complete: img.complete,
              natural: `${img.naturalWidth}x${img.naturalHeight}`,
              ...pick(img),
            }
          : '没有 <img> 节点',
        chain,
      }
    },
  }
} catch {
  // 非用户脚本环境忽略
}
