/**
 * 截图对比：注入组件 + 全部类型勾选前后，首页推荐区长什么样。
 * 输出 shot-before.png / shot-after.png，用来肉眼确认有没有"多出标签"这类视觉副作用。
 */
const CDP_PORT = 9337
const { spawn } = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const profile = path.join(process.env.TEMP ?? '.', 'bhf-shot')
fs.rmSync(profile, { recursive: true, force: true })

const code = fs.readFileSync(path.join('dist', 'home-feed-filter.js'), 'utf8')

const chrome = spawn(
  CHROME,
  [
    '--headless=new',
    `--remote-debugging-port=${CDP_PORT}`,
    `--user-data-dir=${profile}`,
    '--no-first-run',
    '--disable-gpu',
    '--window-size=1600,1000',
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

  // 滚到推荐区
  await send('Runtime.evaluate', {
    expression: `document.querySelector('.recommended-container')?.scrollIntoView({block:'start'}); window.scrollBy(0, -80);`,
  })
  await sleep(1200)

  const shot = async file => {
    const r = await send('Page.captureScreenshot', { format: 'png' })
    fs.writeFileSync(file, Buffer.from(r.result.data, 'base64'))
  }

  await shot('shot-before.png')

  await send('Runtime.evaluate', { expression: 'window.exports = {};' })
  await send('Runtime.evaluate', { expression: code })
  const entry = await send('Runtime.evaluate', {
    expression: `(() => {
      const comp = window.exports.component;
      const options = { hide_ad: true, hide_live: true, hide_bangumi: true, hide_variety: true, hide_cheese: true, hide_movie: true, hide_doc: true };
      try {
        comp.entry({ settings: { options }, metadata: comp, coreApis: { settings: { addSettingsChangeListener(){}, removeSettingsChangeListener(){} } } });
      } catch (e) { return 'ERR ' + String(e); }
      return 'ok';
    })()`,
    returnByValue: true,
  })
  console.log('entry:', entry.result?.result?.value)
  await sleep(1800)

  await shot('shot-after.png')

  const stat = await send('Runtime.evaluate', {
    expression: `(() => {
      const cards = Array.from(document.querySelectorAll('.feed-card, .bili-video-card, .bili-live-card'))
        .filter(el => !el.parentElement?.closest('.feed-card, .bili-video-card, .bili-live-card'));
      return {
        total: cards.length,
        hidden: cards.filter(el => el.hasAttribute('data-bhf-hidden')).length,
        visible: cards.filter(el => el.offsetParent !== null).length,
        scan: window.__bhf__?.scan?.(),
        hint: document.querySelector('#bhf-hint')?.textContent || null
      };
    })()`,
    returnByValue: true,
  })
  console.log('stat:', JSON.stringify(stat.result?.result?.value, null, 2))

  ws.close()
  chrome.kill()
}

main().catch(err => {
  console.error(err)
  chrome.kill()
  process.exit(1)
})
