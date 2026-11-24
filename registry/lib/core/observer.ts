/**
 * 与 BE `@/core/observer` 对齐的最小子集。
 *
 * 本仓库的独立构建产物没有 BE 的运行环境，所以这里用原生 API 实现等价能力，
 * 保持与 BE 相同的函数签名。当这段源码被拷进 BE 主仓库时，把 import 换成
 * `@/core/observer` 即可，调用点完全不用改。
 *
 * 之所以不在 registry 里直接用 `@/core/observer`：本仓库要独立编译、独立跑
 * 端到端测试，拉不进来 BE 的完整依赖树。这里给出的是"同签名的本地实现"。
 */

/**
 * 监听 document.body 的所有子元素增删（childList + subtree）。
 * 返回 disconnect 函数，等价于 BE 的 `childListSubtree` + 手动的 rAF 节流。
 */
export function observeBodySubtree(onChange: () => void): () => void {
  let rafId = 0
  const observer = new MutationObserver(() => {
    if (rafId) {
      return
    }
    rafId = requestAnimationFrame(() => {
      rafId = 0
      onChange()
    })
  })
  observer.observe(document.body, { childList: true, subtree: true })
  return () => {
    observer.disconnect()
    if (rafId) {
      cancelAnimationFrame(rafId)
      rafId = 0
    }
  }
}
