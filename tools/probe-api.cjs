/**
 * 抓首页推荐接口原始响应：看每张卡片的 goto / card_goto / badge 到底是什么。
 * 同时统计 DOM 里 .is-rcmd 的占比 —— 验证"is-rcmd 是不是所有推荐卡都有"。
 */
const CDP_PORT = 9336
const { spawn } = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const profile = path.join(process.env.TEMP ?? '.', 'bhf-api')
fs.rmSync(profile, { recursive: true, force: true })

const chrome = spawn(
  CHROME,
  [
    '--headless=new',
    `--remote-debugging-port=${CDP_PORT}`,
    `--user-data-dir=${profile}`,
    '--no-first-run',
    '--disable-gpu',
    '--window-size=1600,1200',
    'about:blank',
  ],
  { stdio: 'ignore' }
)

const sleep = ms => new Promise(r => setTimeout(r, ms))

async function main() {
  for (let i = 0; i < 40; i += 1) {
    try {
      const res = await fetch(`http://127.0.0.1:${CDP_PORT}/json/version`)
      if (res.ok) break
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
  const bodies = []
  const hits = []

  ws.addEventListener('message', ev => {
    const msg = JSON.parse(ev.data)
    if (msg.id && pending.has(msg.id)) {
      pending.get(msg.id)(msg)
      pending.delete(msg.id)
      return
    }
    if (msg.method === 'Network.responseReceived') {
      const url = msg.params.response.url
      if (url.includes('feed/rcmd') || url.includes('/top/feed/')) {
        hits.push({ requestId: msg.params.requestId, url })
      }
    }
  })
  await new Promise(r => ws.addEventListener('open', r, { once: true }))
  const send = (method, params = {}) =>
    new Promise(resolve => {
      id += 1
      pending.set(id, resolve)
      ws.send(JSON.stringify({ id, method, params }))
    })

  await send('Page.enable')
  await send('Network.enable')
  await sleep(10000)

  // 滚动几次，触发更多批次
  for (let i = 0; i < 3; i += 1) {
    await send('Runtime.evaluate', { expression: 'window.scrollBy(0, 1400)' })
    await sleep(2500)
  }

  for (const hit of hits) {
    const body = await send('Network.getResponseBody', { requestId: hit.requestId })
    if (body.result?.body) {
      bodies.push({ url: hit.url, body: body.result.body })
    }
  }

  fs.mkdirSync('probe', { recursive: true })
  bodies.forEach((b, i) => fs.writeFileSync(path.join('probe', `rcmd-${i}.json`), b.body))

  const summary = bodies.map(({ url, body }) => {
    let data
    try {
      data = JSON.parse(body)
    } catch {
      return { url, parse: false }
    }
    const items = data?.data?.item ?? []
    return {
      url: url.slice(0, 90),
      count: items.length,
      items: items.map(it => ({
        goto: it.goto,
        card_goto: it.card_goto,
        card_type: it.card_type,
        badge: it.badge,
        left1: it.cover_left_text_1,
        leftIcon1: it.cover_left_icon_1,
        title: String(it.title ?? '').slice(0, 18),
        uri: String((it.uri ?? it.bvid) ? it.uri : '').slice(0, 60),
        bvid: it.bvid,
      })),
    }
  })

  const dom = await send('Runtime.evaluate', {
    expression: `(() => {
      const all = Array.from(document.querySelectorAll('.feed-card, .bili-video-card, .bili-live-card'))
      const top = all.filter(el => !el.parentElement?.closest('.feed-card, .bili-video-card, .bili-live-card'))
      const cls = {}
      top.forEach(el => { const c = String(el.className); cls[c] = (cls[c] || 0) + 1 })
      return {
        total: top.length,
        rcmd: top.filter(el => el.classList.contains('is-rcmd')).length,
        classes: cls,
        sample: top.slice(0, 3).map(el => el.outerHTML.slice(0, 700))
      }
    })()`,
    returnByValue: true,
  })

  console.log('=== DOM ===')
  console.log(JSON.stringify(dom.result?.result?.value, null, 2).slice(0, 3000))
  console.log('=== API ===')
  console.log(JSON.stringify(summary, null, 2).slice(0, 6000))

  ws.close()
  chrome.kill()
}

main().catch(err => {
  console.error(err)
  chrome.kill()
  process.exit(1)
})
