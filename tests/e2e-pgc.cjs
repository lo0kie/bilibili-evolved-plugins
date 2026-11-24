/**
 * PGC 子类型解析 —— 用真实 season_id 造卡片，验证"番剧/国创/纪录片/综艺"能分开。
 * 只勾「综艺 + 纪录片」：这两类隐藏，番剧 / 国创 必须保留。
 */
const path = require('node:path')
const { launch, createReporter } = require('./harness.cjs')

/** 真实 season_id：47836 番剧 / 28747 国创 / 104938 纪录片 / 318350 综艺 */
const CASES = [
  ['番剧-鬼灭', 'ss47836', false],
  ['国创-凡人', 'ss28747', false],
  ['纪录片-柯南幕后', 'ss104938', true],
  ['综艺-最美的夜', 'ss318350', true],
]

async function main() {
  const page = await launch({ port: 9352 })
  const r = createReporter('PGC 子类型解析')
  try {
    await page.load(path.join(process.cwd(), 'dist/home-feed-filter.js'))
    await page.entry('homeFeedFilter', { hide_variety: true, hide_doc: true })

    await page.eval(`(() => {
      const box = document.createElement('div');
      box.id = 'bhf-test-box';
      box.innerHTML = ${JSON.stringify(
        CASES.map(
          ([name, sid]) =>
            `<div class="feed-card" data-test="${sid}" style="width:300px;height:220px">` +
            `<a href="//www.bilibili.com/bangumi/play/${sid}"><img style="width:300px;height:120px"></a>` +
            `<span>${name}</span></div>`
        ).join('')
      )};
      document.body.appendChild(box);
    })()`)

    // 等 season 接口返回 + 重新 apply
    for (let i = 0; i < 10; i += 1) {
      await page.sleep(700)
      const resolved = await page.eval('window.__bhf__.pgc().resolved')
      if (resolved >= CASES.length) break
    }

    const rows =
      await page.eval(`Array.from(document.querySelectorAll('#bhf-test-box > *')).map(el => ({
      sid: el.dataset.test, hidden: el.hasAttribute('data-bhf-hidden')
    }))`)
    for (const [name, sid, want] of CASES) {
      const row = rows.find(x => x.sid === sid)
      r.check(name, !!row && row.hidden === want, `hidden=${row?.hidden} 期望=${want}`)
    }

    // __bhf__ 是 src 版的调试入口；registry 版（BE 主仓库形态）刻意不暴露，
    // 此时跳过这条诊断断言（核心的卡片隐藏断言在上面已经覆盖）。
    const pgc = await page.eval('window.__bhf__ ? window.__bhf__.pgc() : null')
    if (pgc) {
      r.check(
        'season 接口可用',
        pgc.disabled === false,
        `resolved=${pgc.resolved} failures=${pgc.failures}`
      )
    } else {
      r.skip('season 接口诊断', 'registry 版无 __bhf__ 调试入口')
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
