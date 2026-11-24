import esbuild from 'esbuild'
import http from 'node:http'
import {
  createReadStream,
  existsSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import path from 'node:path'
import JavaScriptObfuscator from 'javascript-obfuscator'

const dev = process.argv.includes('--dev')
const skipObfuscate = process.argv.includes('--no-obfuscate')
const PORT = 5178

/**
 * 每个模块都是独立的 BE 自定义组件，各自打包成一个单文件 IIFE。
 *
 * 产物必须是 IIFE：BE 用 `Function('window', 'with (window) { return eval(code) }')`
 * 执行，with 对象的 has 恒为 true，任何顶层标识符（包括函数声明）都会被拦成 undefined。
 *
 * 导出也不能在源码里写 `exports.component = ...`：esbuild 会据此判定 CommonJS，
 * 把整个文件包进 __commonJS，赋值落到内部的假 exports 上，沙箱拿到的仍是空对象。
 * 所以走 globalName + footer 两段式。
 */
/**
 * 两套源码：
 *   - src/    独立构建（本地安装 / 第三方收录），走相对导入，无 @/ 别名
 *   - registry/lib/  BE 主仓库形态，走 @/ 别名（@/components、@/core），
 *                    由 esbuild 的 alias 解析到 registry/lib/
 *
 * 两套共享同一份业务逻辑（classify / scan / styles），只是入口与类型/工具
 * 的 import 风格不同。默认构建 src/；`--registry` 构建 registry/lib/。
 */
const buildRegistry = process.argv.includes('--registry')

const MODULES = buildRegistry
  ? [
      {
        name: 'topbar-controls',
        global: 'bhcTopbar',
        title: '顶栏控件管理 (Topbar Controls)',
        entry: 'registry/lib/components/style/topbar-controls/index.ts',
        alias: { '@': path.resolve('registry/lib') },
      },
      {
        name: 'home-feed-filter',
        global: 'bhcHomeFeed',
        title: '首页推荐过滤 (Home Feed Filter)',
        entry: 'registry/lib/components/utils/home-feed-filter/index.ts',
        alias: { '@': path.resolve('registry/lib') },
      },
    ]
  : [
      {
        name: 'topbar-controls',
        global: 'bhcTopbar',
        title: '顶栏控件管理 (Topbar Controls)',
        entry: 'src/modules/topbar-controls/index.ts',
      },
      {
        name: 'home-feed-filter',
        global: 'bhcHomeFeed',
        title: '首页推荐过滤 (Home Feed Filter)',
        entry: 'src/modules/home-feed-filter/index.ts',
      },
    ]

const OUT_DIR = 'dist'

const bannerOf = module => `/**
 * ${module.title}
 * 类型: Bilibili Evolved 自定义组件 (component)
 *
 * 本文件由构建脚本生成，请勿直接编辑。
 * 源码: ${module.entry}    构建: npm run build
 */`

const footerOf = module =>
  [
    '/* 写入 BE 沙箱注入的 exports；最后一行作为 eval 的返回值兜底 */',
    `exports.component = ${module.global}.component;`,
    `${module.global}.component;`,
  ].join('\n')

/**
 * 混淆配置。取舍是按体积实测定的（15.1 KB 压缩后为基准）：
 *
 *   mangled 重命名            21.7 KB
 *   + 字符串数组              21.9 KB   ← 采用
 *   + base64 字符串           35.1 KB
 *   + 控制流平坦化            40.3 KB
 *   + 全套（base64+平坦化+切片）52.4 KB
 *
 * 后三种只让体积翻 2~3 倍，防抄收益很小，所以只保留前两项。
 * 另外三个"看起来更强"的选项直接关掉：
 *   - selfDefending：会破坏二次格式化，偶发在 BE 的 with(window) 沙箱里报错
 *   - debugProtection：会卡死调试器，出问题连现场都看不到
 *   - deadCodeInjection：体积暴涨，等价于给自己加噪声
 *
 * renameGlobals 必须为 false：footer 里的 `exports.component = <global>.component`
 * 依赖顶层变量名，改了就拿不到组件。
 */
const OBFUSCATE_OPTIONS = {
  compact: true,
  target: 'browser',
  identifierNamesGenerator: 'mangled',
  renameGlobals: false,
  stringArray: true,
  stringArrayThreshold: 0.6,
  simplify: true,
  deadCodeInjection: false,
  selfDefending: false,
  debugProtection: false,
  disableConsoleOutput: false,
  unicodeEscapeSequence: false,
  comments: false,
}

/** 混淆单文件；banner 在混淆后补，否则会被粗暴裁掉 */
function obfuscateFile(file, module) {
  // 混淆会保留 footer（footer 由 esbuild 在构建阶段就写进去了），
  // 但混淆器会把字符串表初始化函数挪到文件末尾，导致 footer 不再是最后一句。
  // 所以这里读回文件、去掉末尾 footer、混淆正文、再重新拼 footer。
  const source = readFileSync(file, 'utf8')
  const footer = footerOf(module)
  const body = source.endsWith(footer) ? source.slice(0, source.length - footer.length) : source
  const started = Date.now()
  const result = JavaScriptObfuscator.obfuscate(body, OBFUSCATE_OPTIONS).getObfuscatedCode()
  const banner = `/*! ${module.title} | Bilibili Evolved 自定义组件 | 构建产物，请勿直接编辑 */\n`
  /*
   * footer 必须在混淆之后拼，理由有两条：
   *   1. 混淆器会把字符串表初始化函数挪到文件末尾（位置还不固定），
   *      如果 footer 一起进去，`exports.component = ...` 可能不再是最后一句，
   *      eval 的兜底返回值就丢了；
   *   2. 顶层变量名（renameGlobals: false）不会被改，脚本末尾引用是安全的。
   */
  writeFileSync(file, `${banner}${result}\n${footer}\n`, 'utf8')
  const before = (source.length / 1024).toFixed(1)
  const after = (result.length / 1024).toFixed(1)
  console.log(
    `  ${module.name}: 混淆压缩 ${before} KB → ${after} KB，用时 ${Date.now() - started}ms`
  )
}

/** 静态服务：给 BE「从链接安装」用，带 CORS，改源码保存即刷新 */
function serve(dir) {
  const MIME = { '.js': 'text/javascript; charset=utf-8', '.map': 'application/json' }
  const root = path.resolve(dir)
  const server = http.createServer((req, res) => {
    const url = decodeURIComponent((req.url ?? '/').split('?')[0])
    if (url === '/') {
      const files = existsSync(root) ? readdirSync(root).filter(f => f.endsWith('.js')) : []
      const links = files.map(f => `<li><a href="/${f}">${f}</a></li>`).join('')
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
      res.end(`<meta charset="utf-8"><h3>可用产物</h3><ul>${links}</ul>`)
      return
    }
    const file = path.join(root, url.replace(/^\/+/, ''))
    if (!file.startsWith(root) || !existsSync(file) || !statSync(file).isFile()) {
      res.writeHead(404, { 'access-control-allow-origin': '*' })
      res.end('not found')
      return
    }
    res.writeHead(200, {
      'content-type': MIME[path.extname(file)] ?? 'application/octet-stream',
      'access-control-allow-origin': '*',
      'cache-control': 'no-store',
    })
    createReadStream(file).pipe(res)
  })
  return new Promise(resolve => {
    server.listen(PORT, () => resolve(server))
  })
}

const contexts = []
for (const module of MODULES) {
  contexts.push(
    await esbuild.context({
      entryPoints: [module.entry],
      bundle: true,
      format: 'iife',
      globalName: module.global,
      target: ['chrome100', 'firefox115'],
      outfile: `${OUT_DIR}/${module.name}.js`,
      charset: 'utf8',
      legalComments: 'none',
      // 开发时保持可读（要热更新、要看堆栈），正式构建才压缩
      minify: !dev,
      logLevel: 'info',
      banner: { js: dev ? bannerOf(module) : '' },
      footer: { js: footerOf(module) },
      ...(module.alias ? { alias: module.alias } : {}),
    })
  )
}

if (dev) {
  await Promise.all(contexts.map(ctx => ctx.watch()))
  await serve(OUT_DIR)
  console.log(`\n  产物目录: http://localhost:${PORT}/`)
  for (const module of MODULES) {
    console.log(`    ${module.name}: http://localhost:${PORT}/${module.name}.js`)
  }
  console.log('  在 BE 设置面板用「从链接安装」填对应地址，改源码保存后刷新页面即可\n')
} else {
  await Promise.all(
    contexts.map(ctx =>
      ctx.rebuild().then(() => {
        ctx.dispose()
      })
    )
  )
  console.log(
    `\n  已构建 ${MODULES.length} 个模块到 ${OUT_DIR}/${buildRegistry ? '（registry 形态）' : ''}`
  )
  if (skipObfuscate) {
    console.log('  已跳过混淆（--no-obfuscate）')
  } else {
    for (const module of MODULES) {
      obfuscateFile(`${OUT_DIR}/${module.name}.js`, module)
    }
  }
}
