const CDP_PORT = 9342
const { spawn } = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const profile = path.join(process.env.TEMP ?? '.', 'bhf-hid')
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
  await send('Runtime.evaluate', { expression: 'window.exports = {};' })
  await send('Runtime.evaluate', { expression: code })
  await send('Runtime.evaluate', {
    expression: `(() => {
    const comp = window.exports.component;
    comp.entry({ settings: { options: { hide_ad:true, hide_live:true, hide_bangumi:true, hide_variety:true, hide_cheese:true, hide_doc:true, hide_movie:true, hide_tv:true, hide_guochuang:true } }, metadata: comp,
      coreApis: { settings: { addSettingsChangeListener(){}, removeSettingsChangeListener(){} } } });
  })()`,
  })
  await sleep(2500)
  const r = await send('Runtime.evaluate', {
    expression: `(() => {
      const m = new Map();
      document.querySelectorAll('[class*="floor"]').forEach(el => {
        const c = String(el.className);
        const key = c.includes('floor-single-card') ? 'floor-single-card' : c.split(' ').filter(t=>t.includes('floor'))[0];
        if (!key) return;
        m.set(key, (m.get(key)||0) + 1);
      });
      return Array.from(m.entries());
    })()`,
    returnByValue: true,
  })
  console.log(JSON.stringify(r.result?.result?.value, null, 1))
  ws.close()
  chrome.kill()
}
main().catch(e => {
  console.error(e)
  chrome.kill()
  process.exit(1)
})
