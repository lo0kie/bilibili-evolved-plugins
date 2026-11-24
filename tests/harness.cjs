/**
 * tests/ 共用的无头 Chrome 驱动。
 *
 * 所有测试用例都从这里拿 send / evaluate / 沙箱加载，避免每个文件抄一遍 CDP 样板。
 * 用法：
 *   const { launch, BE_SANDBOX } = require('./harness.cjs')
 *   const page = await launch({ port: 9350 })
 *   await page.load(componentPath)      // 按 BE 沙箱的方式加载产物
 *   const v = await page.eval('window.__bhf__.state()')
 *   await page.close()
 */

const { spawn } = require('node:child_process')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const CHROME = process.env.BHF_CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe'

const sleep = ms => new Promise(r => setTimeout(r, ms))

async function launch({ port = 9350, width = 1600, height = 1200, profile } = {}) {
  const dir = profile || path.join(os.tmpdir(), `bhf-test-${port}`)
  fs.rmSync(dir, { recursive: true, force: true })

  const chrome = spawn(
    CHROME,
    [
      '--headless=new',
      `--remote-debugging-port=${port}`,
      `--user-data-dir=${dir}`,
      '--no-first-run',
      '--disable-gpu',
      `--window-size=${width},${height}`,
      'about:blank',
    ],
    { stdio: 'ignore' }
  )

  for (let i = 0; i < 60; i += 1) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/json/version`)
      if (res.ok) break
    } catch {
      /* 还没起来 */
    }
    await sleep(250)
  }

  const target = await (
    await fetch(`http://127.0.0.1:${port}/json/new?https://www.bilibili.com/`, { method: 'PUT' })
  ).json()

  const ws = new WebSocket(target.webSocketDebuggerUrl)
  let seq = 0
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
      seq += 1
      pending.set(seq, resolve)
      ws.send(JSON.stringify({ id: seq, method, params }))
    })

  await send('Runtime.enable')
  await send('Page.enable')
  await sleep(9000)

  /** 在页面里求值，默认按值返回 */
  const evaluate = async (expression, { byValue = true } = {}) => {
    const res = await send('Runtime.evaluate', { expression, returnByValue: byValue })
    if (res.exceptionDetails) {
      throw new Error(
        res.exceptionDetails.exception?.description ?? JSON.stringify(res.exceptionDetails)
      )
    }
    return res.result?.result?.value
  }

  return {
    send,
    eval: evaluate,
    sleep,
    /**
     * 加载产物并返回组件元信息。
     *
     * 用页面上下文（window.exports + 直接 eval 整个文件）而不是自己搭 with 沙箱：
     * BE 的真实沙箱里 `with (window)` 的 has 恒为 true，任何自建的简化模拟都会
     * 把顶层变量一律判成 undefined —— 那样连未混淆的旧版本也"测不过"，没有判据价值。
     * 这里测的是真正会出问题的地方：文件能否执行、exports.component 是否拿到、
     * 末尾兜底表达式是否还在。
     */
    async load(componentPath) {
      const code = fs.readFileSync(componentPath, 'utf8')
      await evaluate('window.exports = {}')
      const res = await send('Runtime.evaluate', { expression: code })
      if (res.exceptionDetails) {
        throw new Error(res.exceptionDetails.exception?.description ?? '加载时抛异常')
      }
      const text = code.trimEnd()
      return evaluate(`(() => {
        const c = window.exports.component;
        return {
          name: c?.name,
          displayName: c?.displayName,
          options: c && c.options ? Object.keys(c.options) : [],
          hasEntry: typeof c?.entry === 'function',
          hasUnload: typeof c?.unload === 'function',
          hasExportsAssign: ${JSON.stringify(text.includes('exports.component'))},
          tailOk: ${JSON.stringify(/[A-Za-z_$][\w$]*\.component;\s*$/.test(text))},
          bytes: ${code.length},
        };
      })()`)
    },
    /** 启动组件的 entry()，options 直接传对象 */
    async entry(name, options) {
      return evaluate(`(() => {
        const comp = window.exports.component;
        if (!comp) return 'exports.component 为空';
        comp.entry({
          settings: { options: ${JSON.stringify(options ?? {})} },
          metadata: comp,
          coreApis: { settings: { addSettingsChangeListener(){}, removeSettingsChangeListener(){} } },
        });
        return 'ok';
      })()`)
    },
    async screenshot(file) {
      const shot = await send('Page.captureScreenshot', { format: 'png' })
      fs.mkdirSync(path.dirname(file), { recursive: true })
      fs.writeFileSync(file, Buffer.from(shot.result.data, 'base64'))
      return file
    },
    async close() {
      try {
        ws.close()
      } catch {
        /* ignore */
      }
      chrome.kill()
    },
  }
}

/** 简单断言 + 汇总，测试文件末尾调用 */
function createReporter(title) {
  const rows = []
  return {
    check(name, ok, detail) {
      rows.push({ name, ok, detail })
      console.log(`${ok ? 'OK  ' : 'FAIL'} ${name}${detail ? `  ${detail}` : ''}`)
    },
    /** 环境不满足（比如本次页面没渲染楼层卡）时跳过，不计入失败 */
    skip(name, detail) {
      console.log(`SKIP ${name}${detail ? `  ${detail}` : ''}`)
    },
    done() {
      const failed = rows.filter(r => !r.ok)
      console.log(`\n${title}: ${rows.length - failed.length}/${rows.length} 通过`)
      if (failed.length > 0) {
        process.exitCode = 1
      }
    },
  }
}

module.exports = { launch, createReporter }
