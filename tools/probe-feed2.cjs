/**
 * 探测第二轮：滚到底，把非普通投稿的卡片（直播 / PGC / 课堂）连同角标节点一起 dump 出来。
 */
const CDP_PORT = 9334
const { spawn } = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const profile = path.join(process.env.TEMP ?? '.', 'bhf-probe2')
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

async function connect() {
  for (let i = 0; i < 40; i += 1) {
    try {
      const res = await fetch(`http://127.0.0.1:${CDP_PORT}/json/version`)
      if (res.ok) return true
    } catch {
      /* 未就绪 */
    }
    await sleep(250)
  }
  throw new Error('CDP 未就绪')
}

async function main() {
  await connect()
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
  await sleep(8000)

  // 滚三次，触发无限加载
  for (let i = 0; i < 3; i += 1) {
    await send('Runtime.evaluate', {
      expression: `window.scrollBy(0, document.documentElement.clientHeight * 1.2)`,
    })
    await sleep(2500)
  }

  const expr = `(() => {
    const SEL = '.feed-card, .bili-video-card, .bili-live-card';
    const cards = Array.from(document.querySelectorAll(SEL))
      .filter(el => !el.parentElement?.closest(SEL));
    const badgeSel = '[class*="icon-text"], [class*="badge"], [class*="tag"], [class*="label"], [class*="corner"]';
    const info = cards.map(el => {
      const hrefs = Array.from(el.querySelectorAll('a[href]')).slice(0, 6).map(a => a.getAttribute('href'));
      const badges = Array.from(el.querySelectorAll(badgeSel)).slice(0, 8).map(b => ({
        cls: b.className,
        text: (b.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 16)
      }));
      const shorts = [];
      const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
      let n = w.nextNode(), k = 0;
      while (n && k < 150 && shorts.length < 12) {
        const t = (n.nodeValue || '').replace(/\\s+/g, '');
        if (t && t.length <= 6 && !shorts.includes(t)) shorts.push(t);
        k++; n = w.nextNode();
      }
      return {
        cls: String(el.className),
        kind: hrefs.some(h => (h||'').includes('live.bilibili.com')) ? 'live'
             : hrefs.some(h => (h||'').includes('/bangumi/')) ? 'pgc'
             : hrefs.some(h => (h||'').includes('/cheese/')) ? 'cheese'
             : hrefs.some(h => (h||'').includes('/video/')) ? 'video' : 'other',
        hrefs, badges, shorts,
        h: Math.round(el.getBoundingClientRect().height)
      };
    });
    return {
      total: cards.length,
      kinds: info.reduce((m, x) => (m[x.kind] = (m[x.kind]||0)+1, m), {}),
      nonVideo: info.filter(x => x.kind !== 'video').slice(0, 8),
      tallVideo: info.filter(x => x.kind === 'video' && x.h > 320).slice(0, 3)
    };
  })()`

  const res = await send('Runtime.evaluate', { expression: expr, returnByValue: true })
  const value = res.result?.result?.value
  fs.writeFileSync(path.join(process.cwd(), 'probe2.json'), JSON.stringify(value, null, 2))
  console.log(JSON.stringify(value, null, 2).slice(0, 7000))

  ws.close()
  chrome.kill()
}

main().catch(err => {
  console.error(err)
  chrome.kill()
  process.exit(1)
})
