/**
 * 首页推荐流的卡片类型判定。
 *
 * B 站首页推荐是客户端渲染 + 无限滚动，卡片混排四类来源：
 *   1. 普通投稿（UGC）        → /video/BV...
 *   2. 直播（live）            → //live.bilibili.com/{room}
 *   3. PGC（番剧/电影/纪录片…）→ /bangumi/play/{ep|ss}
 *   4. 课堂（cheese）          → /cheese/play/{ep}
 *
 * PGC 的 2/3/4 共用同一套卡片结构，光看链接区分不出「番剧」和「纪录片」，
 * 必须读卡片上的角标文字（封面左下角那个带图标的「番剧」「直播」小块）。
 *
 * 判定链路做成多级、每级都保守：
 *   属性 → 角标(class 命中) → 链接(直播/课程) → 叶子文字(精确) → 链接(PGC) → 兜底 video
 *
 * 两条容易踩的坑，都已规避：
 *   - **不能只看第一个 <a>**：卡片里第一个链接常常是 UP 主空间或统计入口，
 *     内容链接排在后面。必须遍历前几个 anchor。
 *   - **不能全文匹配关键词**：标题里带「电影」两个字的普通投稿会被误杀。
 *     所以文字匹配要么限定在角标类名上（可 includes），要么限定成"短叶子节点 + 精确相等"。
 */

export type FeedType =
  | 'live'
  | 'doc'
  | 'movie'
  | 'guochuang'
  | 'variety'
  | 'tv'
  | 'bangumi'
  | 'cheese'
  | 'manga'
  | 'ad'
  | 'video'

export interface TypeDef {
  key: FeedType
  label: string
  /** 角标文字关键词（包含即命中，用于 class 命中的角标节点） */
  words: string[]
}

/** 顺序即优先级：越具体的排前面 */
export const TYPES: TypeDef[] = [
  { key: 'live', label: '直播', words: ['直播'] },
  { key: 'doc', label: '纪录片', words: ['纪录片', '纪录'] },
  { key: 'movie', label: '电影', words: ['电影'] },
  { key: 'guochuang', label: '国创', words: ['国创'] },
  { key: 'variety', label: '综艺', words: ['综艺'] },
  { key: 'tv', label: '电视剧', words: ['电视剧', '连续剧'] },
  { key: 'bangumi', label: '番剧', words: ['番剧'] },
  { key: 'cheese', label: '课程', words: ['课程', '课堂'] },
  { key: 'manga', label: '漫画', words: ['漫画'] },
  { key: 'ad', label: '广告', words: ['广告', '推广'] },
]

/**
 * 角标节点。B 站各版本命名不一，用 class 片段兜住。
 * `stats--` 是封面左下角那层（PGC 的「番剧 / 综艺 / 纪录片」和播放量叠在一起），
 * v1.0.x 漏了它，导致所有 PGC 子类都判不出来。
 */
const BADGE_SELECTOR = [
  '[class*="icon-text"]',
  '[class*="stats--"]',
  '[class*="badge"]',
  '[class*="tag"]',
  '[class*="label"]',
  '[class*="corner"]',
].join(',')

/** 兜底用的精确词表（文本节点整体等于其中之一即命中） */
const EXACT_WORDS: Array<[string, FeedType]> = [
  ['直播', 'live'],
  ['直播中', 'live'],
  ['正在直播', 'live'],
  ['番剧', 'bangumi'],
  ['新番', 'bangumi'],
  ['纪录片', 'doc'],
  ['记录片', 'doc'],
  ['电影', 'movie'],
  ['国创', 'guochuang'],
  ['国漫', 'guochuang'],
  ['综艺', 'variety'],
  ['真人秀', 'variety'],
  ['电视剧', 'tv'],
  ['连续剧', 'tv'],
  ['课程', 'cheese'],
  ['课堂', 'cheese'],
  ['漫画', 'manga'],
  ['广告', 'ad'],
  ['推广', 'ad'],
  ['商单', 'ad'],
]

/**
 * 兜底文字扫描要跳过的容器：UP 名 / 简介 / 日期 —— 这些位置的文字没有类型含义，
 * 扫进去只会增加误判（比如 UP 主叫「电影迷小雅」，把整张卡判成电影）。
 *
 * **不能跳标题容器**：角标经常就挂在标题那一行
 * （`<div class="...info--tit"><span class="...icon-text">综艺</span> 标题…</div>`），
 * 一跳就把角标一起跳掉了。
 *
 * **也不能跳 stats**：PGC 的「番剧 / 综艺 / 纪录片」角标就叠在封面左下角，
 * 和播放量 / 弹幕数同一个 `.bili-video-card__stats` 容器里。
 * v1.0.x 跳了 stats，等于把唯一能区分 PGC 各子类的文字跳掉了 —— 这是
 * 「勾了番剧/综艺没反应」的真正原因。
 */
const TEXT_SKIP =
  '[class*="up-"],[class*="author"],[class*="desc"],[class*="date"],[class*="info--bottom"]'

function badgeText(card: Element): string {
  const parts: string[] = []
  const nodes = card.querySelectorAll(BADGE_SELECTOR)
  for (let i = 0; i < nodes.length && i < 8; i += 1) {
    const text = (nodes[i].textContent ?? '').replace(/\s+/g, ' ').trim()
    // 只收"像角标"的短文本：长文本是标题/简介，带数字的是播放量 / 弹幕数 / 时长
    if (text && text.length <= 8 && !/\d/.test(text)) {
      parts.push(text)
    }
  }
  return parts.join(' ')
}

/** 卡片里前几个链接（第一根通常是 UP 主空间，内容链接在后面） */
function hrefsOf(card: Element, max = 8): string[] {
  const list: string[] = []
  const nodes = card.querySelectorAll('a[href]')
  for (let i = 0; i < nodes.length && i < max; i += 1) {
    list.push(nodes[i].getAttribute('href') ?? '')
  }
  return list
}

/**
 * 从卡片链接里取 PGC 的 season / ep 标识。
 *
 * 推荐流里 PGC 卡片（番剧/电影/纪录片/国创/电视剧/综艺）的链接是
 * `//www.bilibili.com/bangumi/play/ss{season_id}`，只有这个 id 能反查子类型，
 * 详见 season.ts。
 */
export function pgcKeyOf(
  card: Element,
  hrefs = hrefsOf(card)
): { kind: 'ss' | 'ep'; id: string } | null {
  for (const href of hrefs) {
    const ss = /\/bangumi\/play\/ss(\d+)/.exec(href)
    if (ss) {
      return { kind: 'ss', id: ss[1] }
    }
    const ep = /\/bangumi\/play\/ep(\d+)/.exec(href)
    if (ep) {
      return { kind: 'ep', id: ep[1] }
    }
  }
  return null
}

/**
 * 兜底：遍历卡片里的**文本节点**，整体等于类型词即命中。
 *
 * 为什么按文本节点而不是按元素：角标经常是「图标 + 文字」混排，
 * 例如 `<div class="xxx-badge"><i class="icon" />综艺</div>` ——
 * 这种元素带着子元素，按"叶子元素"扫会整条跳过，这正是综艺/课堂/直播
 * 一直不命中的原因。文本节点天然把图标和文字拆开了。
 */
function textNodeType(card: Element): FeedType | null {
  if (typeof document.createTreeWalker !== 'function') {
    return null
  }
  const walker = document.createTreeWalker(card, NodeFilter.SHOW_TEXT)
  let checked = 0
  let node = walker.nextNode()
  while (node && checked < 200) {
    const text = (node.nodeValue ?? '').replace(/\s+/g, '')
    if (text && text.length <= 4) {
      const parent = node.parentElement
      if (parent && !parent.closest(TEXT_SKIP)) {
        const hit = EXACT_WORDS.find(([word]) => word === text)
        if (hit) {
          return hit[1]
        }
      }
    }
    checked += 1
    node = walker.nextNode()
  }
  return null
}

/** B 站有时会在卡片上直接标 goto 类型，优先采信 */
function attrType(card: Element): FeedType | null {
  const raw = (card.getAttribute('data-goto') ?? card.getAttribute('data-type') ?? '').toLowerCase()
  if (!raw) {
    return null
  }
  if (raw === 'live') {
    return 'live'
  }
  if (raw === 'pgc' || raw === 'bangumi' || raw === 'ogv') {
    return 'bangumi'
  }
  if (raw === 'cheese') {
    return 'cheese'
  }
  return null
}

/**
 * 卡片自身的结构信号：比文字更稳，因为 class 不会被标题/角标排版改动影响。
 * `.bili-live-card` 这类节点在直播卡里一定存在；PGC / 课堂的专用节点也一样。
 */
function classType(card: Element): FeedType | null {
  if (card.querySelector('.bili-live-card, [class*="live-card"], [class*="live__"]')) {
    return 'live'
  }
  if (card.querySelector('[class*="cheese-card"], [class*="cheese-badge"]')) {
    return 'cheese'
  }
  return null
}

export function classify(card: Element, hrefs = hrefsOf(card)): FeedType {
  const byAttr = attrType(card)
  if (byAttr) {
    return byAttr
  }

  const byClass = classType(card)
  if (byClass) {
    return byClass
  }

  // 广告卡：实测（headless Chrome 抓首页得到的真实结构）
  //   `goto:"ad"` 的 item 渲染成 `.bili-video-card is-rcmd`，卡片内所有链接都指向
  //   `//cm.bilibili.com/...` 的埋点。广告没有标题、没有 BV 号，链接是唯一硬特征。
  //
  // ⚠️ 绝不能用 `is-rcmd` 判断广告：实测首页 72 个卡片节点里 48 个带 `is-rcmd`
  //   （38 个 `bili-video-card is-rcmd enable-no-interest`、8 个 `bili-video-card is-rcmd`、
  //   2 个 `bili-live-card is-rcmd`），也就是**所有真实卡片都带这个类**。
  //   v1.0.3 ~ v1.0.7 用它当广告特征，勾上「过滤 · 广告」等于把整个推荐流清空。
  if (
    hrefs.some(href => href.includes('cm.bilibili.com')) ||
    card.querySelector('a[href*="cm.bilibili.com"]')
  ) {
    return 'ad'
  }

  // 漫画楼层卡：链接固定指向 manga.bilibili.com（比读「漫画」角标更稳）
  if (hrefs.some(href => href.includes('manga.bilibili.com'))) {
    return 'manga'
  }

  // 1. 角标（class 命中，可以 includes）
  const badge = badgeText(card)
  if (badge) {
    for (const type of TYPES) {
      if (type.words.some(word => badge.includes(word))) {
        return type.key
      }
    }
  }

  // 2. 链接里最确定的两类
  if (hrefs.some(href => href.includes('live.bilibili.com'))) {
    return 'live'
  }
  if (hrefs.some(href => href.includes('/cheese/'))) {
    return 'cheese'
  }

  // 3. 短叶子文字（精确相等，跳过标题/统计区）
  const byText = textNodeType(card)
  if (byText) {
    return byText
  }

  // 4. PGC 兜底：链接是 /bangumi/ 但没有可读角标，归到"番剧"这一档
  if (hrefs.some(href => href.includes('/bangumi/'))) {
    return 'bangumi'
  }

  return 'video'
}

/** 判定指纹：链接或角标变了就重新判 */
export function signatureOf(card: Element): string {
  return `${hrefsOf(card, 4).join('|')}|${card.className}`
}

/**
 * 结构线索：卡片内所有 class 里带类型语义的节点（pgc / bangumi / season / live / cheese / badge / icon-text）。
 * 角标若是图片或伪元素，文字抓不到，但 B 站往往会给节点挂个带类型语义的 class，这里能直接看到。
 */
export function structHints(limit = 24): string[] {
  const out: string[] = []
  const pat = /(pgc|bangumi|season|cinema|cheese|live|badge|icon-text|tag)/i
  const all = Array.from(document.querySelectorAll('.feed-card, .bili-video-card, .bili-live-card'))
  const cards = all.filter(
    el => !el.parentElement?.closest('.feed-card, .bili-video-card, .bili-live-card')
  )
  for (const card of cards) {
    if (out.length >= limit) {
      break
    }
    card.querySelectorAll('[class]').forEach(el => {
      const cls =
        typeof (el as HTMLElement).className === 'string'
          ? String((el as HTMLElement).className)
          : ''
      if (!cls) {
        return
      }
      const hit = cls.split(' ').find(token => pat.test(token))
      if (hit && !out.includes(hit) && out.length < limit) {
        const text = (el.textContent ?? '').replace(/\s+/g, '').slice(0, 8)
        out.push(text ? `${hit}=${text}` : hit)
      }
    })
  }
  return out
}

/**
 * 词汇表诊断：推荐区里所有 ≤6 字的文本、alt、title，连同所在节点的第一个 class。
 * 用来定位"看得见但抓不到"的角标 —— 角标若不是文本节点（图片 / 伪元素 / alt），
 * 这里就会暴露成 `番剧@xxx` 或干脆没有，从而确定该走哪条读取路径。
 */
export function vocab(limit = 50): string[] {
  const out: string[] = []
  const push = (value: string | null | undefined, el: Element | null): void => {
    const text = (value ?? '').replace(/\s+/g, '')
    // 只留纯中文词：把播放量/时长/日期这些统计噪声全过滤掉，
    // 剩下的基本就是标题、UP 名和角标文字
    if (!/^[\u4e00-\u9fa5]{2,6}$/.test(text)) {
      return
    }
    const rawCls =
      el && typeof (el as HTMLElement).className === 'string'
        ? String((el as HTMLElement).className)
        : ''
    const cls = rawCls.split(' ').filter(Boolean)[0]?.slice(0, 30) ?? ''
    const item = cls ? `${text}@${cls}` : text
    if (!out.includes(item) && out.length < limit) {
      out.push(item)
    }
  }

  // 只扫卡片内部：整页扫会被顶部导航的「番剧/电影/综艺…」分区链接刷屏
  const all = Array.from(document.querySelectorAll('.feed-card, .bili-video-card, .bili-live-card'))
  const cards = all.filter(
    el => !el.parentElement?.closest('.feed-card, .bili-video-card, .bili-live-card')
  )
  if (cards.length === 0 || typeof document.createTreeWalker !== 'function') {
    return out
  }

  for (const card of cards) {
    if (out.length >= limit) {
      break
    }
    const walker = document.createTreeWalker(card, NodeFilter.SHOW_TEXT)
    let node = walker.nextNode()
    let checked = 0
    while (node && checked < 200 && out.length < limit) {
      push(node.nodeValue, node.parentElement)
      checked += 1
      node = walker.nextNode()
    }
    // 角标可能是 <img alt="番剧"> 或 title
    card.querySelectorAll('[alt], [title]').forEach(el => {
      push(el.getAttribute('alt'), el)
      push(el.getAttribute('title'), el)
    })
  }

  return out
}

/** 卡片里所有 ≤6 字的短文本，用来看"角标到底长什么样" */
export function shortTexts(card: Element, limit = 8): string[] {
  const out: string[] = []
  if (typeof document.createTreeWalker !== 'function') {
    return out
  }
  const walker = document.createTreeWalker(card, NodeFilter.SHOW_TEXT)
  let checked = 0
  let node = walker.nextNode()
  while (node && checked < 200 && out.length < limit) {
    const text = (node.nodeValue ?? '').replace(/\s+/g, '')
    const parent = node.parentElement
    const rawCls = parent ? (typeof parent.className === 'string' ? parent.className : '') : ''
    const first = rawCls.split(' ').filter(Boolean)[0]?.slice(0, 26) ?? ''
    const item = first ? `${text}@${first}` : text
    if (text && text.length <= 6 && !out.includes(item)) {
      out.push(item)
    }
    checked += 1
    node = walker.nextNode()
  }
  return out
}

/** 封面区 HTML（角标基本都在这里），诊断用；去掉注释和多余空白 */
export function coverHtml(card: Element, max = 260): string {
  const img = card.querySelector('a[href] img')
  const cover = (img?.closest('a[href]') ?? card.querySelector('a[href]')) as Element | null
  if (!cover) {
    return ''
  }
  return cover.innerHTML
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max)
}

/**
 * 封面左下角那层文字（角标 + 播放量 + 时长）。
 * 「带标签的卡片」到底标的是什么，看这个最短 —— 诊断用。
 */
export function cornerText(card: Element): string {
  const nodes = card.querySelectorAll('[class*="stats"]')
  for (let i = 0; i < nodes.length && i < 4; i += 1) {
    const text = (nodes[i].textContent ?? '').replace(/\s+/g, '')
    if (text && text.length <= 16) {
      return text
    }
  }
  return ''
}

/** 调试：把一张卡片的判定依据摊开，用来核对选择器是否命中 */
export function explain(card: Element): Record<string, unknown> {
  return {
    cls: String(card.className).slice(0, 80),
    attr: card.getAttribute('data-goto') ?? card.getAttribute('data-type') ?? '',
    badge: badgeText(card),
    hrefs: hrefsOf(card, 4),
    text: textNodeType(card),
    shorts: shortTexts(card, 6),
    cover: coverHtml(card),
    type: classify(card),
  }
}
