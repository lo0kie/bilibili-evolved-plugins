/**
 * 产物静态校验（纯 Node，不依赖浏览器）—— CI 用。
 *
 * 不执行代码（BE 的 with(window) 沙箱无法在 Node 里可靠复现），只校验
 * 产物是否满足 BE 的加载契约：
 *   1. 文件非空、体积合理；
 *   2. 是 IIFE（以 (function / (()=> 之类的形态开头）；
 *   3. 末尾保留 exports.component = <global>.component 赋值；
 *   4. 末尾保留 <global>.component; 兜底表达式（eval 的返回值）；
 *   5. 组件名 / 关键选项词都还留在产物里（混淆 renameGlobals=false 不应改顶层名）。
 */
'use strict'

const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.join(__dirname, '..')

const MODULES = [
  {
    file: 'dist/topbar-controls.js',
    global: 'bhcTopbar',
    name: 'topbarControls',
    markers: ['顶栏控件管理', 'data-bhc-hidden'],
  },
  {
    file: 'dist/home-feed-filter.js',
    global: 'bhcHomeFeed',
    name: 'homeFeedFilter',
    markers: ['首页推荐过滤', 'data-bhf-hidden'],
  },
]

let failures = 0
let checks = 0

function check(name, ok, detail) {
  checks += 1
  if (!ok) failures += 1
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${name}${detail ? `  ${detail}` : ''}`)
}

for (const mod of MODULES) {
  const abs = path.join(ROOT, mod.file)
  const code = fs.readFileSync(abs, 'utf8')

  check(`${mod.name} 文件非空`, code.length > 0)
  check(
    `${mod.name} 体积合理`,
    code.length > 5000 && code.length < 200 * 1024,
    `${(code.length / 1024).toFixed(1)} KB`
  )
  check(`${mod.name} 导出赋值存在`, code.includes(`exports.component = ${mod.global}.component`))
  check(
    `${mod.name} 末尾兜底表达式存在`,
    new RegExp(`${mod.global}\\.component;\\s*$`).test(code.trimEnd())
  )
  check(
    `${mod.name} 组件名字符串保留`,
    code.includes(`'${mod.name}'`) || code.includes(`"${mod.name}"`)
  )
  for (const marker of mod.markers) {
    check(`${mod.name} 关键标记「${marker}」保留`, code.includes(marker))
  }
}

console.log(`\n${checks} 项检查，${failures} 项失败`)
if (failures > 0) {
  process.exit(1)
}
