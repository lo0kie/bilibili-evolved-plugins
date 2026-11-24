/**
 * 首页推荐过滤 —— 真实页面端到端。
 * 勾选 广告/直播/番剧/综艺/课程，断言：广告被隐藏、普通投稿全部保留、隐藏的格子不占位。
 */
const path = require('node:path')
const { launch, createReporter } = require('./harness.cjs')

const OPTIONS = {
  hide_ad: true,
  hide_live: true,
  hide_bangumi: true,
  hide_variety: true,
  hide_cheese: true,
}

async function main() {
  const page = await launch({ port: 9351 })
  const r = createReporter('首页推荐过滤 / e2e')
  try {
    await page.load(path.join(process.cwd(), 'dist/home-feed-filter.js'))
    await page.entry('homeFeedFilter', OPTIONS)
    await page.sleep(2000)

    // 1. 判定链路自检（纯逻辑，不依赖线上结构变化）
    const cases = await page.eval('window.__bhf__.selftest()')
    const failed = cases.filter(c => !c.ok)
    r.check(
      '判定自检',
      failed.length === 0,
      failed.map(c => `${c.name}->${c.got}`).join(',') || `${cases.length} 条全过`
    )

    // 2. 隐藏结果
    const state = await page.eval('window.__bhf__.state()')
    r.check('扫到卡片', state.total > 10, `total=${state.total}`)
    r.check(
      '隐藏数量与标记一致',
      state.hidden === state.marked,
      `hidden=${state.hidden} marked=${state.marked}`
    )
    r.check(
      '普通投稿未被隐藏',
      state.byType.video > 0 && state.visible >= state.byType.video,
      `video=${state.byType.video} visible=${state.visible}`
    )

    // 3. 广告必须真的看不见（含文字残留）
    const adLeft =
      await page.eval(`Array.from(document.querySelectorAll('.bili-video-card, .bili-live-card'))
      .filter(el => /广告/.test(el.textContent || '') && el.getBoundingClientRect().height > 0).length`)
    r.check('页面无残留广告', adLeft === 0, `残留 ${adLeft} 张`)

    // 4. 隐藏的是"占格子的那一层"，不能留下空洞
    const holes = await page.eval(
      `Array.from(document.querySelectorAll('[data-bhf-hidden]')).filter(el => el.offsetHeight > 0).length`
    )
    r.check('隐藏的格子不占位', holes === 0, `仍占位 ${holes} 个`)
  } finally {
    r.done()
    await page.close()
  }
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
