import type { CachedItem, TopbarItem } from './types'
import { kvStorage } from '../../shared/kv-storage'

// v5：头像不再参与扫描，旧缓存里那条会把幽灵开关带回来，换 key 直接作废
const CACHE_KEY = 'bhc:items:v5'

/**
 * 缓存的意义：B 站顶栏右侧是客户端渲染，页面刚加载时代码被执行时可能还扫不到。
 * 把上一次的扫描结果存起来，代码执行早期就能生成完整的选项列表。
 * 走 GM 存储（不可用时退回 localStorage），不和站点数据混在一起。
 */
export function readCache(): CachedItem[] {
  try {
    const raw = kvStorage().get(CACHE_KEY)
    const arr: unknown = raw ? JSON.parse(raw) : []
    if (!Array.isArray(arr)) {
      return []
    }
    return arr.filter(
      (x): x is CachedItem =>
        !!x &&
        typeof x === 'object' &&
        typeof (x as CachedItem).key === 'string' &&
        typeof (x as CachedItem).label === 'string'
    )
  } catch {
    return []
  }
}

export function saveCache(list: Array<TopbarItem | CachedItem>): void {
  try {
    const slim: CachedItem[] = list.map(({ key, label, side }) => ({ key, label, side }))
    kvStorage().set(CACHE_KEY, JSON.stringify(slim))
  } catch {
    // 隐私模式下写入失败，忽略
  }
}

export function clearCache(): void {
  try {
    kvStorage().remove(CACHE_KEY)
  } catch {
    // 忽略
  }
}

/** 以实时扫描为准，缓存补齐未渲染的项 */
export function mergeItems(live: TopbarItem[], cached: CachedItem[]): CachedItem[] {
  const out: CachedItem[] = live.map(({ key, label, side }) => ({ key, label, side }))
  cached.forEach(item => {
    if (!out.some(x => x.key === item.key)) {
      out.push({ key: item.key, label: item.label, side: item.side })
    }
  })
  return out
}
