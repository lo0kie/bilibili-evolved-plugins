/**
 * 持久化键值存储：优先 GM 存储（GM_getValue / GM_setValue），
 * 不可用时退回 localStorage。
 *
 * 为什么要走 GM 存储：localStorage 和站点数据混在一起，站点的清理 / 扩展卸载 /
 * 隐私模式都会受影响；GM 存储由油猴托管，跟脚本走、更干净。
 * 本仓库独立构建时没有 GM 环境，自动退回 localStorage，行为等价。
 */

interface KvStorage {
  get(key: string): string | null
  set(key: string, value: string): void
  remove(key: string): void
}

function gmStorage(): KvStorage | null {
  const g = window as unknown as {
    GM_getValue?: (key: string, def?: unknown) => unknown
    GM_setValue?: (key: string, value: unknown) => void
    GM_deleteValue?: (key: string) => void
  }
  if (
    typeof g.GM_getValue !== 'function' ||
    typeof g.GM_setValue !== 'function' ||
    typeof g.GM_deleteValue !== 'function'
  ) {
    return null
  }
  return {
    get(key) {
      const v = g.GM_getValue!(key, null)
      return typeof v === 'string' ? v : null
    },
    set(key, value) {
      g.GM_setValue!(key, value)
    },
    remove(key) {
      g.GM_deleteValue!(key)
    },
  }
}

function localStorageStorage(): KvStorage {
  return {
    get(key) {
      try {
        return window.localStorage.getItem(key)
      } catch {
        return null
      }
    },
    set(key, value) {
      try {
        window.localStorage.setItem(key, value)
      } catch {
        // 隐私模式 / 配额满，忽略
      }
    },
    remove(key) {
      try {
        window.localStorage.removeItem(key)
      } catch {
        // 忽略
      }
    },
  }
}

let instance: KvStorage | null = null

export function kvStorage(): KvStorage {
  if (!instance) {
    instance = gmStorage() ?? localStorageStorage()
  }
  return instance
}
