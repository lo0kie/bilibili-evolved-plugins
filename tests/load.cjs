/**
 * 产物结构测试：混淆压缩之后，仍然满足 BE 的加载契约。
 *
 * 检查四件事：
 *   1. 文件能在页面上下文里完整执行，不抛异常；
 *   2. `window.exports.component` 能拿到组件（BE 主要靠这条）；
 *   3. 末尾还保留 `<global>.component;` 兜底表达式（eval 的返回值）；
 *   4. 组件名 / 选项 / entry / unload 齐全。
 *
 * 注意：这里刻意不模拟 BE 的 `with (window)` + Proxy 沙箱。那种自建模拟的
 * `has` 恒为 true，会把所有顶层变量判成 undefined —— 连未混淆的旧产物也过不了，
 * 没有判据价值。真正在线上验证过的是"整段 IIFE + exports 赋值"这一形态。
 */
const path = require('node:path')
const { launch, createReporter } = require('./harness.cjs')

const MODULES = [
  { file: 'dist/topbar-controls.js', name: 'topbarControls' },
  { file: 'dist/home-feed-filter.js', name: 'homeFeedFilter' },
]

async function main() {
  const page = await launch({ port: 9350 })
  const r = createReporter('产物结构')

  try {
    for (const module of MODULES) {
      const file = path.join(process.cwd(), module.file)
      let info
      try {
        info = await page.load(file)
      } catch (err) {
        r.check(`${module.name} 可执行`, false, String(err.message).slice(0, 120))
        continue
      }
      r.check(`${module.name} 可执行且导出`, info?.name === module.name, `name=${info?.name}`)
      r.check(`${module.name} 保留 exports 赋值`, info?.hasExportsAssign === true)
      r.check(`${module.name} 保留末尾兜底表达式`, info?.tailOk === true)
      r.check(`${module.name} 有 entry/unload`, info?.hasEntry === true && info?.hasUnload === true)
      r.check(
        `${module.name} 选项已注册`,
        Array.isArray(info?.options) && info.options.length > 0,
        `${info?.options?.length ?? 0} 个`
      )
      r.check(
        `${module.name} 体积合理`,
        info?.bytes > 5000 && info?.bytes < 200 * 1024,
        `${(info?.bytes / 1024).toFixed(1)} KB`
      )
    }
  } finally {
    r.done()
    await page.close()
  }
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
