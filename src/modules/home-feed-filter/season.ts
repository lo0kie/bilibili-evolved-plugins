/**
 * PGC 子类型解析：这是「番剧 / 电影 / 纪录片 / 国创 / 电视剧 / 综艺」唯一可靠的判据。
 *
 * 为什么必须走接口：
 *   B 站推荐流接口里，这六类全部是同一个 `goto: "ogv_season"`，
 *   卡片数据只有 season_id / title / cover / 播放数，**没有任何子类型字段**；
 *   它们的链接也全是 `/bangumi/play/ss{season_id}`。
 *   也就是说，DOM 和链接在原理上就分不出来 —— 之前几版靠角标文字、靠 class、
 *   靠关键词都失败，根因在这里。
 *
 * 能给出准确答案的是 `pgc/view/web/season`：
 *   GET https://api.bilibili.com/pgc/view/web/season?season_id=47836
 *   → { result: { type: 1 } }
 *   type: 1 番剧 / 2 电影 / 3 纪录片 / 4 国创 / 5 电视剧 / 7 综艺
 *   （同时支持 ?ep_id=826497，会返回所属 season 的 type）
 *
 * 实测该接口对 `Origin: https://www.bilibili.com` 返回
 * `Access-Control-Allow-Origin: https://www.bilibili.com` +
 * `Access-Control-Allow-Credentials: true`，所以页面内直接 fetch 可用。
 *
 * 只对屏幕上出现的 PGC 卡片请求，按 season_id 去重 + localStorage 永久缓存，
 * 一屏最多几次请求，之后零请求。
 */

import type { FeedType } from './classify'
import { kvStorage } from '../../shared/kv-storage'

const STORE_KEY = 'bhf:season:v1'
const MAX_ENTRIES = 600
/** 连续失败这么多次就彻底放弃（接口被墙 / CORS 变更 / 风控），退回纯 DOM 判定 */
const FAIL_LIMIT = 3

/** B 站 pgc season type → 我们的类型 */
const TYPE_BY_SEASON: Record<number, FeedType> = {
  1: 'bangumi',
  2: 'movie',
  3: 'doc',
  4: 'guochuang',
  5: 'tv',
  7: 'variety',
}

export interface PgcKey {
  kind: 'ss' | 'ep'
  id: string
}

const cache = new Map<string, FeedType>()
const inflight = new Set<string>()
let failures = 0
let loaded = false
let disabled = false
let listener: (() => void) | null = null

function keyOf(key: PgcKey): string {
  return `${key.kind}${key.id}`
}

function load(): void {
  if (loaded) {
    return
  }
  loaded = true
  try {
    const raw = kvStorage().get(STORE_KEY)
    if (!raw) {
      return
    }
    const data = JSON.parse(raw) as Record<string, FeedType>
    Object.keys(data).forEach(key => cache.set(key, data[key]))
  } catch {
    // 存储被禁用 / 内容损坏，直接当空缓存
  }
}

function save(): void {
  try {
    const entries = Array.from(cache.entries()).slice(-MAX_ENTRIES)
    kvStorage().set(STORE_KEY, JSON.stringify(Object.fromEntries(entries)))
  } catch {
    // 存不下就算了，只影响下次启动的请求量
  }
}

export function setSeasonResolvedListener(fn: () => void): void {
  listener = fn
}

/** 已解析条数 + 是否已停用，诊断用 */
export function seasonStats(): { resolved: number; disabled: boolean; failures: number } {
  load()
  return { resolved: cache.size, disabled, failures }
}

/**
 * 查一个 PGC 卡片的真实类型。
 *   - 命中缓存 → 直接返回类型
 *   - 未命中且 notify=true → 发起一次请求（去重），返回 null
 *   - 未命中且 notify=false → 只查缓存，不请求（诊断 / 报告用）
 */
export function seasonTypeOf(key: PgcKey, notify = true): FeedType | null {
  load()
  const k = keyOf(key)
  const hit = cache.get(k)
  if (hit) {
    return hit
  }
  if (!disabled && notify && !inflight.has(k)) {
    void request(key, k)
  }
  return null
}

async function request(key: PgcKey, k: string): Promise<void> {
  inflight.add(k)
  try {
    const param = key.kind === 'ss' ? 'season_id' : 'ep_id'
    const url = `https://api.bilibili.com/pgc/view/web/season?${param}=${key.id}`
    const res = await fetch(url, { credentials: 'include' })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const json = (await res.json()) as { code?: number; result?: { type?: number } }
    if (json.code === 0 && typeof json.result?.type === 'number') {
      const type = TYPE_BY_SEASON[json.result.type] ?? 'bangumi'
      cache.set(k, type)
      save()
      failures = 0
      listener?.()
      return
    }
    // 接口明确回了错误（番剧已下架之类）：按番剧处理，避免每帧重试
    cache.set(k, 'bangumi')
    save()
    listener?.()
  } catch {
    // 网络 / CORS 失败：不缓存，但累计失败次数，连续失败就整体停用
    failures += 1
    if (failures >= FAIL_LIMIT) {
      disabled = true
      console.warn('[首页推荐过滤] PGC 类型接口不可用，退回 DOM 判定（按「番剧」处理）')
    }
  } finally {
    inflight.delete(k)
  }
}
