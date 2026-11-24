/**
 * 用本机 Chrome（headless）打开 B 站首页，抓推荐卡片的真实 DOM 结构。
 * 只做只读探测，不登录、不写任何数据。
 */
const CDP_PORT = 9333
const { spawn } = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const profile = path.join(process.env.TEMP ?? '.', 'bhf-probe-profile')
fs.rmSync(profile, { recursive: true, force: true })

const chrome = spawn(
  CHROME,
  [
    '--headless=new',
    `--remote-debugging-port=${CDP_PORT}`,
    `--user-data-dir=${profile}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-gpu',
    '--window-size=1600,1000',
    'about:blank',
  ],
  { stdio: 'ignore' }
)

const sleep = ms => new Promise(r => setTimeout(r, ms))

async function connect() {
  for (let i = 0; i < 40; i += 1) {
    try {
      const res = await fetch(`http://127.0.0.1:${CDP_PORT}/json/version`)
      if (res.ok) return (await res.json()).webSocketDebuggerUrl
    } catch {
      /* 还没起来 */
    }
    await sleep(250)
  }
  throw new Error('CDP 未就绪')
}

async function main() {
  const browserWs = await connect()
  const target = await (
    await fetch(`http://127.0.0.1:${CDP_PORT}/json/new?https://www.bilibili.com/`, {
      method: 'PUT',
    })
  ).json()

  const ws = new WebSocket(target.webSocketDebuggerUrl)
  let id = 0
  const pending = new Map()
  ws.addEventListener('message', ev => {
    const msg = JSON.parse(ev.data)
    if (msg.id && pending.has(msg.id)) {
      pending.get(msg.id)(msg)
      pending.delete(msg.id)
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
  await send('Runtime.enable')
  await sleep(9000) // 等推荐接口 + 渲染

  const expr = `(() => {
    const cards = Array.from(document.querySelectorAll('.feed-card, .bili-video-card, .bili-live-card'));
    const outer = cards.filter(el => !el.parentElement?.closest('.feed-card, .bili-video-card, .bili-live-card'));
    const brief = el => {
      const a = Array.from(el.querySelectorAll('a[href]')).slice(0, 5).map(x => x.getAttribute('href'));
      const shorts = [];
      const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
      let n = w.nextNode(), k = 0;
      while (n && k < 120 && shorts.length < 10) {
        const t = (n.nodeValue || '').replace(/\\s+/g, '');
        if (t && t.length <= 6 && !shorts.includes(t)) shorts.push(t);
        k++; n = w.nextNode();
      }
      return { cls: el.className, tag: el.tagName, hrefs: a, shorts };
    };
    return {
      total: cards.length,
      outerCount: outer.length,
      sample: outer.slice(0, 12).map(brief),
      feedRoots: Array.from(document.querySelectorAll('[class*="recommend"], [id*="reco"], .bili-feed4')).map(e => e.className || e.id).slice(0, 8)
    };
  })()`

  const res = await send('Runtime.evaluate', { expression: expr, returnByValue: true })
  const value = res.result?.result?.value
  fs.writeFileSync(path.join(process.cwd(), 'probe.json'), JSON.stringify(value, null, 2))
  console.log(JSON.stringify(value, null, 2).slice(0, 6000))

  ws.close()
  chrome.kill()
}

main().catch(err => {
  console.error(err)
  chrome.kill()
  process.exit(1)
})
