/**
 * 去各分区页抓带角标的卡片真实结构（登录态不需要，专区页是公开的）。
 * 目标：找出「综艺 / 番剧 / 纪录片」这类角标到底是哪个节点、什么 class。
 */
const CDP_PORT = 9336
const { spawn } = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const profile = path.join(process.env.TEMP ?? '.', 'bhf-probe3')
fs.rmSync(profile, { recursive: true, force: true })

const PAGES = [
  ['variety', 'https://www.bilibili.com/variety/'],
  ['documentary', 'https://www.bilibili.com/documentary/'],
  ['live', 'https://live.bilibili.com/'],
]

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

async function page(wsUrl, url, name) {
  const ws = new WebSocket(wsUrl)
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
  await send('Page.navigate', { url })
  await sleep(7000)

  const expr = `(() => {
    const SEL = '.bili-video-card, .feed-card, .bili-live-card, [class*="card"]';
    const cards = Array.from(document.querySelectorAll('.bili-video-card, .feed-card, .bili-live-card'));
    const sample = cards.slice(0, 4).map(el => {
      const html = el.outerHTML.replace(/\\s+/g, ' ').slice(0, 900);
      const shorts = [];
      const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
      let n = w.nextNode(), k = 0;
      while (n && k < 120 && shorts.length < 12) {
        const t = (n.nodeValue || '').replace(/\\s+/g, '');
        if (t && t.length <= 6) {
          const cls = n.parentElement ? n.parentElement.className : '';
          shorts.push(t + '@' + String(cls).slice(0, 32));
        }
        k++; n = w.nextNode();
      }
      return { cls: el.className, html, shorts };
    });
    return { url: location.href, total: cards.length, sample };
  })()`

  const res = await send('Runtime.evaluate', { expression: expr, returnByValue: true })
  const value = res.result?.result?.value
  fs.writeFileSync(path.join('probe3-' + name + '.json'), JSON.stringify(value, null, 2))
  console.log(`===== ${name} (${value?.total ?? 0} cards) =====`)
  for (const c of value?.sample ?? []) {
    console.log('cls:', c.cls)
    console.log('shorts:', c.shorts.join(' | '))
    console.log('html:', c.html.slice(0, 500))
    console.log('---')
  }
  ws.close()
}

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
  for (const [name, url] of PAGES) {
    const target = await (
      await fetch(`http://127.0.0.1:${CDP_PORT}/json/new?about:blank`, { method: 'PUT' })
    ).json()
    try {
      await page(target.webSocketDebuggerUrl, url, name)
    } catch (e) {
      console.log(name, '失败', String(e))
    }
  }
  chrome.kill()
}

main().catch(err => {
  console.error(err)
  chrome.kill()
  process.exit(1)
})
