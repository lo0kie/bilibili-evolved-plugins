/**
 * 按行看首页推荐：每行每张卡的 class / 角标文字 / 链接。
 * 用来确认"每一行最后一个带标签的卡片"到底是什么节点。
 */
const CDP_PORT = 9339
const { spawn } = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const profile = path.join(process.env.TEMP ?? '.', 'bhf-row')
fs.rmSync(profile, { recursive: true, force: true })
const chrome = spawn(
  CHROME,
  [
    '--headless=new',
    `--remote-debugging-port=${CDP_PORT}`,
    `--user-data-dir=${profile}`,
    '--no-first-run',
    '--disable-gpu',
    '--window-size=2560,1400',
    'about:blank',
  ],
  { stdio: 'ignore' }
)
const sleep = ms => new Promise(r => setTimeout(r, ms))

async function main() {
  for (let i = 0; i < 40; i += 1) {
    try {
      if ((await fetch(`http://127.0.0.1:${CDP_PORT}/json/version`)).ok) break
    } catch {
      /* 未就绪 */
    }
    await sleep(250)
  }
  const target = await (
    await fetch(`http://127.0.0.1:${CDP_PORT}/json/new?https://www.bilibili.com/`, {
      method: 'PUT',
    })
  ).json()
  const ws = new WebSocket(target.webSocketDebuggerUrl)
  let id = 0
  const pending = new Map()
  ws.addEventListener('message', ev => {
    const m = JSON.parse(ev.data)
    if (m.id && pending.has(m.id)) {
      pending.get(m.id)(m)
      pending.delete(m.id)
    }
  })
  await new Promise(r => ws.addEventListener('open', r, { once: true }))
  const send = (method, params = {}) =>
    new Promise(res => {
      id += 1
      pending.set(id, res)
      ws.send(JSON.stringify({ id, method, params }))
    })
  await send('Runtime.enable')
  await sleep(9000)
  for (let i = 0; i < 4; i += 1) {
    await send('Runtime.evaluate', { expression: 'window.scrollBy(0,1200)' })
    await sleep(2000)
  }
  await send('Runtime.evaluate', { expression: 'window.scrollTo(0,0)' })
  await sleep(1200)

  const r = await send('Runtime.evaluate', {
    expression: `(() => {
      const cards = Array.from(document.querySelectorAll('.feed-card, .bili-video-card, .bili-live-card'))
        .filter(el => !el.parentElement?.closest('.feed-card, .bili-video-card, .bili-live-card'))
        .filter(el => el.querySelector('a[href]'))
      const rows = new Map()
      cards.forEach(el => {
        const b = el.getBoundingClientRect()
        if (b.width < 50) return
        const top = Math.round(b.top + window.scrollY)
        // 同一行的 top 会差几像素，量化到 40
        const k = Math.round(top / 60)
        if (!rows.has(k)) rows.set(k, [])
        rows.get(k).push({ el, b })
      })
      return Array.from(rows.values())
        .filter(list => list.length > 1)
        .slice(0, 5)
        .map(list => list
          .sort((a, b) => a.b.left - b.b.left)
          .map(({ el, b }, i) => ({
            pos: i + 1 + '/' + list.length,
            x: Math.round(b.left),
            cls: String(el.className).slice(0, 60),
            inner: el.firstElementChild ? String(el.firstElementChild.className).slice(0, 40) : '',
            href: (el.querySelector('a[href]')?.getAttribute('href') || '').slice(0, 46),
            badge: Array.from(el.querySelectorAll('[class*="badge"],[class*="icon-text"],[class*="tag"],[class*="label"]'))
              .map(n => (n.textContent || '').replace(/\\s+/g, '')).filter(Boolean).slice(0, 3).join('|'),
            html: el.outerHTML.slice(0, 160),
          })))
    })()`,
    returnByValue: true,
  })
  const rows = r.result?.result?.value || []
  rows.forEach((row, i) => {
    console.log(`\n===== 第 ${i + 1} 行 (${row.length} 张) =====`)
    row.forEach(c => console.log(JSON.stringify(c)))
  })
  ws.close()
  chrome.kill()
}

main().catch(e => {
  console.error(e)
  chrome.kill()
  process.exit(1)
})
