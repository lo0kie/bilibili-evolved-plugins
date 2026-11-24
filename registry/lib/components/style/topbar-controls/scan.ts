import type { Side, TopbarItem } from './types'
import { classOf, hashOf, prettyHref, slugOf } from '@/core/util'

/**
 * 顶栏 DOM 结构（2026-11 线上实测）：
 *   .bili-header
 *     .bili-header__menu.bili-header__bar   display:flex; justify-content:space-between
 *       .left-entry.is-zh.menu-left         → .left-entry-main → .left-entry__item × n
 *       .center-search-container.menu-center → .center-search__bar
 *       .right-entry.is-zh.menu-right       → .right-entry__item × n
 *
 * 下滑后 onscroll 会给 .bili-header 加 --mini / --fixed / --slide-down，结构不变。
 */

const MAX_LABEL = 14

interface Root {
  side: Side
  el: Element
}

function findRoots(): Root[] {
  const header =
    document.querySelector('.bili-header') ??
    document.querySelector('.international-header') ??
    document.querySelector('.bili-header__bar')
  if (!header) {
    return []
  }
  const roots: Root[] = []
  // 用 .left-entry 而不是 .left-entry-main：Logo 项是 .left-entry 的直接子级，
  // 不在 .left-entry-main 里，只扫后者会漏掉它
  const left = header.querySelector('.left-entry') ?? header.querySelector('.left-entry-main')
  const right = header.querySelector('.right-entry')
  if (left) {
    roots.push({ side: 'left', el: left })
  }
  if (right) {
    roots.push({ side: 'right', el: right })
  }
  return roots
}

/** 过滤占位/骨架节点，以及 B 站用来测量宽度的影子节点 */
function isNoise(el: Element): boolean {
  const cls = classOf(el)
  return !cls || /loading|placeholder|skeleton|fake-trigger/i.test(cls)
}

/** 类名里是否有以 entry__item 结尾的 token（排除 left-entry__item-trigger 这类子元素） */
function isEntryItem(el: Element): boolean {
  return classOf(el)
    .split(/\s+/)
    .some(token => /entry__item$/.test(token))
}

/**
 * 头像（用户账号）不是可隐藏的顶栏控件，必须从扫描里排除。
 *
 * 它本身是 `<div class="header-avatar-wrap ...">`，往下还有一层 v-popover-wrap，
 * 结构和大顶栏 / mini 两态并不完全一致，key 会随之漂移；一旦某个态下绑到了
 * 一个被关掉的开关，`hideEl` 就会在 `.header-avatar-wrap` 上写内联 display:none，
 * 整块头像（含账号入口）直接消失，而换回另一个态又"回来了"——这就是
 * "固定时头像消失、回到顶部又出现"的真正原因。
 */
export function isAccountItem(el: Element): boolean {
  if (typeof el.closest === 'function' && el.closest('.header-avatar-wrap')) {
    return true
  }
  return !!el.querySelector('.header-avatar-wrap, .header-entry-mini, .header-entry-avatar')
}

/**
 * 取容器下的控件元素。
 *
 * 不能只看直接子元素：B 站会在中间套一层包裹节点（右侧的投稿等项尤其常见），
 * 结构一变就会漏项。这里按"项"而不是按"层级"来抓：
 *   1. 取所有类名以 entry__item 结尾的后代
 *   2. 跳过 .left-entry-fake-triggers 里那份用于测宽的影子副本
 *   3. 去掉嵌套重复（一个项套一个项时只留外层）
 *   4. 一个都没抓到时退回直接子元素（兼容自定义结构）
 */
function collectItems(root: Element): Element[] {
  const found = Array.from(root.querySelectorAll('[class*="entry__item"]')).filter(
    el =>
      isEntryItem(el) &&
      !isNoise(el) &&
      !(typeof el.closest === 'function' && el.closest('[class*="fake-trigger"]'))
  )
  if (found.length > 0) {
    return found
      .filter(el => !found.some(other => other !== el && other.contains(el)))
      .filter(el => !isAccountItem(el))
  }
  return Array.from(root.children).filter(el => !isNoise(el) && !isAccountItem(el))
}

const LOGO_RE = /logo/i

/** 是否是 B 站 Logo 项：自身/后代带 logo 类名，或内含 logo 图 */
function isLogoItem(el: Element): boolean {
  if (LOGO_RE.test(classOf(el))) {
    return true
  }
  if (el.querySelector('.big-logo, [class*="logo"]')) {
    return true
  }
  const img = el.querySelector('img')
  return !!img && LOGO_RE.test(img.getAttribute('src') ?? '')
}

/** 控件显示名称：可见文字 > title > 链接 > 图标序号 */
export function labelOf(el: Element, side: Side, index: number, logo = false): string {
  let text = ''
  const span = el.querySelector('.left-entry__item-trigger, span')
  if (span) {
    text = span.textContent ?? ''
  }
  if (!text) {
    text = el.textContent ?? ''
  }
  text = text.replace(/\s+/g, ' ').trim()
  if (text && text.length <= MAX_LABEL) {
    // Logo 项和"首页"共用同一个链接，名字要区分开
    return logo ? `${text}（Logo 图标）` : text
  }

  const link = el.querySelector('a[href]')
  if (link) {
    const title = link.getAttribute('title')
    if (title) {
      return title
    }
    const pretty = prettyHref(link.getAttribute('href'))
    if (pretty && !logo) {
      return pretty
    }
  }

  const img = el.querySelector('img[alt]')
  const alt = img?.getAttribute('alt')
  if (alt && !logo) {
    return alt
  }
  if (logo) {
    return 'Logo（固定顶栏）'
  }
  return `${side === 'left' ? '左侧' : '右侧'}图标 ${index + 1}`
}

/** 生成稳定 key：优先链接，其次类名 + 内容哈希 */
function keyOf(el: Element, side: Side, used: Set<string>, logo = false): string {
  let base = ''
  if (logo) {
    // Logo 项与首页链接相同，必须独立命名，否则会互相顶掉
    base = 'logo'
  }
  const link = el.querySelector('a[href]')
  if (!base && link) {
    base = prettyHref(link.getAttribute('href'))
  }
  if (!base) {
    const cls = classOf(el)
      .split(/\s+/)
      .filter(c => c && !/^(v-popover-wrap|is-zh|menu-left|menu-right)$/.test(c))
      .join('_')
    base = `${cls || 'item'}_${hashOf((el.innerHTML ?? '').slice(0, 400))}`
  }

  const origin = `${side}_${slugOf(base, 28)}`
  let key = origin
  let n = 1
  while (used.has(key)) {
    n += 1
    key = `${origin}__${n}`
  }
  used.add(key)
  return key
}

/** 扫描当前页面的顶栏控件（含 DOM 引用） */
export function scanNow(): TopbarItem[] {
  const used = new Set<string>()
  const list: TopbarItem[] = []

  findRoots().forEach(({ side, el }) => {
    collectItems(el).forEach((item, index) => {
      const link = item.querySelector('a[href]')
      const raw = link ? link.getAttribute('href') : null
      const logo = isLogoItem(item)
      list.push({
        key: keyOf(item, side, used, logo),
        label: labelOf(item, side, index, logo),
        side,
        el: item,
        href: raw ? raw.replace(/[?#].*$/, '') : '',
        hrefOp: '',
        logo,
      })
    })
  })

  // 链接匹配方式：若某个链接是别的链接的前缀（如首页 //www.bilibili.com），
  // 必须精确匹配，否则会连带隐藏番剧/直播等所有同域项
  const hrefs = list.map(it => it.href).filter(Boolean)
  list.forEach(item => {
    if (!item.href) {
      return
    }
    const isPrefixOfOther = hrefs.some(other => other !== item.href && other.startsWith(item.href))
    item.hrefOp = isPrefixOfOther ? '=' : '^='
  })

  return list
}
