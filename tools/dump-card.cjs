const CDP_PORT = 9337
const { spawn } = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const profile = path.join(process.env.TEMP ?? '.', 'bhf-dump')
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
      if ((await fetch(`http://127.0.0.1:${CDP_PORT}/json/version`)).ok) break
    } catch {}
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
    await send('Runtime.evaluate', { expression: 'window.scrollBy(0,1500)' })
    await sleep(2200)
  }
  const r = await send('Runtime.evaluate', {
    expression: `(() => {
    const all = Array.from(document.querySelectorAll('.bili-video-card, .bili-live-card'))
    const pick = sel => { const el = all.find(e => e.matches(sel) && e.querySelector('a[href]')); return el ? el.outerHTML : null }
    return { video: (pick('.bili-video-card') || '').slice(0, 9000), live: (pick('.bili-live-card') || '').slice(0, 5000) }
  })()`,
    returnByValue: true,
  })
  const v = r.result?.result?.value || {}
  fs.writeFileSync('probe/card-video.html', v.video || '')
  fs.writeFileSync('probe/card-live.html', v.live || '')
  console.log('video bytes', (v.video || '').length, 'live bytes', (v.live || '').length)
  ws.close()
  chrome.kill()
}
main().catch(e => {
  console.error(e)
  chrome.kill()
  process.exit(1)
})
