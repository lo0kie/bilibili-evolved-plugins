/** 隐藏部分类型后截图，观察是否留下空洞 */
const CDP_PORT = 9344
const { spawn } = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const profile = path.join(process.env.TEMP ?? '.', 'bhf-shot')
fs.rmSync(profile, { recursive: true, force: true })
const code = fs.readFileSync(path.join('dist', 'home-feed-filter.js'), 'utf8')
const OPTS = JSON.parse(
  process.env.BHF_OPTS || '{"hide_ad":true,"hide_live":true,"hide_manga":true,"hide_cheese":true}'
)
const OUT = process.env.BHF_OUT || 'probe/filtered.png'
const chrome = spawn(
  CHROME,
  [
    '--headless=new',
    `--remote-debugging-port=${CDP_PORT}`,
    `--user-data-dir=${profile}`,
    '--no-first-run',
    '--disable-gpu',
    '--window-size=1600,1400',
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
  await send('Page.enable')
  await sleep(9000)
  for (let i = 0; i < 3; i += 1) {
    await send('Runtime.evaluate', { expression: 'window.scrollBy(0,900)' })
    await sleep(1500)
  }
  await send('Runtime.evaluate', { expression: 'window.scrollTo(0,900)' })
  await send('Runtime.evaluate', { expression: 'window.exports = {};' })
  await send('Runtime.evaluate', { expression: code })
  await send('Runtime.evaluate', {
    expression: `(() => {
    const comp = window.exports.component;
    comp.entry({ settings: { options: ${JSON.stringify(OPTS)} }, metadata: comp,
      coreApis: { settings: { addSettingsChangeListener(){}, removeSettingsChangeListener(){} } } });
  })()`,
  })
  await sleep(2500)
  const shot = await send('Page.captureScreenshot', { format: 'png' })
  fs.mkdirSync('probe', { recursive: true })
  fs.writeFileSync(OUT, Buffer.from(shot.result.data, 'base64'))
  const st = await send('Runtime.evaluate', {
    expression: `JSON.stringify(Array.from(document.querySelectorAll('[data-bhf-hidden]')).map(el => {
    const p = el.parentElement;
    return {
      cls: String(el.className).slice(0,42),
      parent: p ? p.tagName + '.' + String(p.className).slice(0,34) : null,
      pbox: p ? p.offsetWidth + 'x' + p.offsetHeight : '',
      siblingsVisible: p ? Array.from(p.children).filter(c => c !== el && c.offsetHeight > 20).length : -1,
      pdisp: p ? getComputedStyle(p).display : ''
    };
  }))`,
    returnByValue: true,
  })
  console.log('state', st.result?.result?.value)
  console.log('shot ->', OUT)
  ws.close()
  chrome.kill()
}
main().catch(e => {
  console.error(e)
  chrome.kill()
  process.exit(1)
})
