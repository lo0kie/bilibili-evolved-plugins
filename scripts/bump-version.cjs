#!/usr/bin/env node
/**
 * 版本自增脚本（CI 用，也可本地手动跑）。
 *
 * 规则：每个模块的 patch 位 +1（x.y.z → x.y.(z+1)）。
 *   - 读取 src/modules/ 下各模块 index.ts 里的 const VERSION = 'x.y.z'
 *   - 各自 +1
 *   - 回写文件
 *   - 打印新旧版本映射（供 workflow 读取）
 *
 * 用法：
 *   node scripts/bump-version.cjs            # 全部模块自增
 *   node scripts/bump-version.cjs --dry-run  # 只打印，不写文件
 */
'use strict'

const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.join(__dirname, '..')
const MODULES = [
  { key: 'topbar-controls', file: 'src/modules/topbar-controls/index.ts' },
  { key: 'home-feed-filter', file: 'src/modules/home-feed-filter/index.ts' },
]

const dryRun = process.argv.includes('--dry-run')

/** 解析单个文件里的 VERSION 常量 */
function readVersion(file) {
  const abs = path.join(ROOT, file)
  const src = fs.readFileSync(abs, 'utf8')
  const m = src.match(/const VERSION = '(\d+)\.(\d+)\.(\d+)'/)
  if (!m) {
    throw new Error(`未在 ${file} 找到 const VERSION = 'x.y.z'`)
  }
  return { major: +m[1], minor: +m[2], patch: +m[3] }
}

/** 回写新版本，返回旧/新字符串 */
function writeVersion(file, next) {
  const abs = path.join(ROOT, file)
  let src = fs.readFileSync(abs, 'utf8')
  const nextStr = `${next.major}.${next.minor}.${next.patch}`
  src = src.replace(/const VERSION = '\d+\.\d+\.\d+'/, `const VERSION = '${nextStr}'`)
  if (!dryRun) {
    fs.writeFileSync(abs, src, 'utf8')
  }
  return nextStr
}

const results = []
for (const mod of MODULES) {
  const cur = readVersion(mod.file)
  const next = { ...cur, patch: cur.patch + 1 }
  const nextStr = writeVersion(mod.file, next)
  results.push({
    key: mod.key,
    file: mod.file,
    from: `${cur.major}.${cur.minor}.${cur.patch}`,
    to: nextStr,
  })
}

if (dryRun) {
  console.log('[dry-run] 只会打印，不写文件：')
}

for (const r of results) {
  console.log(`${r.key}: ${r.from} → ${r.to}`)
}

// 给 workflow 用的单行汇总（形如 "topbar-controls:3.7.4,home-feed-filter:1.4.2"）
console.log('SUMMARY=' + results.map(r => `${r.key}:${r.to}`).join(','))

// 供 release 标题用的首个模块新版本（约定取 topbar-controls）
const topbar = results.find(r => r.key === 'topbar-controls')
if (topbar) {
  console.log(`RELEASE_TAG=v${topbar.to}`)
}
