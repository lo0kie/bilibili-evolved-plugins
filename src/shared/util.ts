/** djb2 变体，用于给无链接控件生成稳定后缀 */
export function hashOf(text: string): string {
  let hash = 5381
  for (let i = 0; i < text.length; i += 1) {
    hash = ((hash << 5) + hash + text.charCodeAt(i)) | 0
  }
  return (hash >>> 0).toString(36)
}

/** 转成只含 [a-z0-9_] 的片段，用作选项名（选项名会拼进设置路径，不能含点） */
export function slugOf(text: string, max = 32): string {
  const slug = String(text)
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, max)
  return slug || 'x'
}

/** //www.bilibili.com/anime/?x=1 → www.bilibili.com/anime */
export function prettyHref(href: string | null): string {
  if (!href) {
    return ''
  }
  return href
    .replace(/^https?:/, '')
    .replace(/^\/\//, '')
    .replace(/[?#].*$/, '')
    .replace(/\/$/, '')
}

/** 转义成可安全放进 CSS 属性选择器的字符串 */
export function cssAttrValue(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
}

/** 从元素上取类名（Element.className 可能是 SVGAnimatedString） */
export function classOf(el: Element): string {
  return typeof el.className === 'string' ? el.className : ''
}
