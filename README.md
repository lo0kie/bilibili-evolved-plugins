# Bilibili Evolved 自定义组件集

每个模块都是**一个独立的 BE 自定义组件**。同一份业务逻辑维护成两套形态：

- **`src/`** —— 独立构建产物（本地「从链接安装」/ 第三方收录用），走相对导入；
- **`registry/lib/`** —— BE 主仓库形态（`@/` 别名、`defineComponentMetadata`、`index.md` 描述），可直接拷进 BE 的 `registry/lib/components/` 提 PR。

| 模块         | 产物                       | 作用                                                    | 文档                                                 |
| ------------ | -------------------------- | ------------------------------------------------------- | ---------------------------------------------------- |
| 顶栏控件管理 | `dist/topbar-controls.js`  | 顶栏控件逐个显隐、间距、边缘对齐、常驻顶部              | [docs/topbar-controls.md](docs/topbar-controls.md)   |
| 首页推荐过滤 | `dist/home-feed-filter.js` | 按类型隐藏首页推荐卡片：直播 / 番剧 / 纪录片 / 电影 / … | [docs/home-feed-filter.md](docs/home-feed-filter.md) |

## 目录结构

```
build.mjs                    多模块构建（压缩 + 混淆）+ 静态服务（CORS）
src/                         独立构建形态（相对导入，本地安装 / 第三方收录）
  shared/
    types.ts                 ComponentMetadata / OptionMetadata / ComponentContext
    util.ts                  hashOf / slugOf / prettyHref / cssAttrValue / classOf
    kv-storage.ts            GM 存储优先、localStorage 回退
  modules/
    topbar-controls/         顶栏控件管理
      index.ts / scan.ts / cache.ts / styles.ts / types.ts
    home-feed-filter/        首页推荐过滤
      index.ts / classify.ts / season.ts
registry/lib/                BE 主仓库形态（@/ 别名，可直接拷进 BE 提 PR）
  components/
    types.ts                 ComponentMetadata / OptionMetadata 等（对齐 BE 定义）
    define.ts                defineComponentMetadata
  core/
    observer.ts              observeBodySubtree（同 BE @/core/observer 签名）
    kv-storage.ts            GM 存储
    util.ts
  components/style/topbar-controls/      index.ts + index.md + 子模块
  components/utils/home-feed-filter/     index.ts + index.md + 子模块
dist/                        构建产物（混淆压缩后提交进仓库，BE 从这里安装）
docs/                        每个模块的设计与踩坑记录
tests/                       自动化用例（headless Chrome 端到端，独立于源码）
tools/                       开发期探测脚本（抓线上 DOM / 结构）
scripts/bump-version.cjs     版本自增脚本（CI 用，也可本地手动跑）
.github/workflows/ci.yml     持续集成 + 自动发布
```

## 命令

```bash
pnpm install
pnpm run check          # tsc --noEmit，src + registry 全量类型检查
pnpm run build          # 构建 src/ 形态到 dist/（压缩 + 混淆）
pnpm run build:clean    # 只压缩、不混淆（调试用，产物可读）
pnpm run build:registry # 构建 registry/ 形态（不混淆，用于验证 @/ 别名能打包）
pnpm run dev            # watch + 在 5178 端口起带 CORS 的静态服务（不混淆）
pnpm run format         # prettier 格式化全部源码
pnpm run format:check   # 只检查格式，不改动
pnpm test               # 跑全部自动化用例（产物结构 + 首页端到端 + PGC 解析）
pnpm run test:ci        # CI 用：纯 Node 产物契约校验（不依赖 Chrome）
pnpm run test:load      # 只跑产物结构测试（需要本机 Chrome）
pnpm run test:feed      # 只跑首页端到端
pnpm run test:pgc       # 只跑 PGC 子类型解析
```

`pnpm run dev` 之后：

```
http://localhost:5178/                     产物列表
http://localhost:5178/topbar-controls.js
http://localhost:5178/home-feed-filter.js
```

在 BE 设置面板底部「安装自定义组件 → 从链接安装」填对应地址；改源码保存后刷新页面即可拿到新版本。

### 产物形态

`pnpm run build` 产出的是**压缩 + 混淆**后的单文件，体积与效果按实测做过取舍：

| 选项                         | 体积（以 home-feed-filter 15.1 KB 为基准） |
| ---------------------------- | ------------------------------------------ |
| esbuild 压缩（不混淆）       | 15.1 KB                                    |
| + 变量重命名（mangled）      | 21.7 KB                                    |
| + 字符串数组                 | 21.9 KB（**采用**）                        |
| + base64 字符串编码          | 35.1 KB                                    |
| + 控制流平坦化               | 40.3 KB                                    |
| + 全套（base64+平坦化+切片） | 52.4 KB                                    |

后三档只是体积翻 2~3 倍、防抄收益很小，所以默认只做到「重命名 + 字符串数组」。`selfDefending` /
`debugProtection` / `deadCodeInjection` 被刻意关闭：前两者会破坏 BE 沙箱或卡死调试器，第三个纯属加噪声。

`pnpm run dev` 与 `pnpm run build:clean` 都不混淆，便于开发时看堆栈、对拍。

## 新增一个模块

1. 建目录 `src/modules/<name>/`，写好 `index.ts` 并 `export const component: ComponentMetadata`；
2. 在 `build.mjs` 的 `MODULES` 里加一条（`name` / `global` / `title` / `entry`）， `global` 必须在全仓库唯一 ——
   footer 会用它往沙箱 `exports` 上挂组件；
3. `pnpm run build`，产物出现在 `dist/<name>.js`。

## 提交到 BE 主仓库（路线 A）

`registry/lib/` 已经按 BE 官方要求整理好，两套形态共享同一份业务逻辑，差异只在入口与 import 风格：

| 项            | src/（独立构建）               | registry/lib/（BE 主仓库）                        |
| ------------- | ------------------------------ | ------------------------------------------------- |
| 组件定义      | 裸 `ComponentMetadata` 对象    | `defineComponentMetadata(...)`                    |
| 描述          | 写在 `description` 字段        | 拆到 `index.md`（编译自动注入）                   |
| 导入          | 相对路径                       | `@/components/...`、`@/core/...`                  |
| 调试入口      | `unsafeWindow.__bhf__/__bhc__` | **无**（已移除）                                  |
| DOM 监听      | 手写 MutationObserver + rAF    | `observeBodySubtree`（同 `@/core/observer` 签名） |
| 持久缓存      | localStorage                   | GM 存储（`@/core/kv-storage`，localStorage 回退） |
| reload/unload | 顶层成对定义                   | 顶层成对定义                                      |

要提 PR 时，把 `registry/lib/components/<分类>/<kebab-name>/` 整个拷进 BE 仓库对应目录即可。
拷进去之后，`observeBodySubtree` 和 `kvStorage` 可以直接换成 BE 原生的 `@/core/observer` 和
GM API（签名一致，调用点不用改），`define.ts` / `types.ts` 用 BE 自带的即可。

提交前记得跑 BE 的三项检查：`pnpm run check-pr-files`、`pnpm run type`、`pnpm run lint-check`。

## 持续集成与自动发布（CI/CD）

`.github/workflows/ci.yml` 里有两个 job：

1. **test**（每次 push / PR 都跑）：`format:check` → `check`（tsc）→ `build`（混淆压缩）→ `test:ci`（纯 Node 产物契约校验，不依赖浏览器）。
2. **release**（仅 push 到 `main` 且 commit 不含 `[skip ci]`）：版本自增 + 回写 + 自动发布。

**版本自增规则**：每个模块的 patch 位 +1（`x.y.z` → `x.y.(z+1)`），两个模块各自独立：

```
topbar-controls:  3.7.3 → 3.7.4
home-feed-filter: 1.4.1 → 1.4.2
```

流程是：push 到 `main` → CI 跑 `scripts/bump-version.cjs` 自增两个 `index.ts` 里的 `VERSION` →
重新构建产物 → 提交（message 带 `[skip ci]`，避免死循环）→ 用 `softprops/action-gh-release`
创建 Release（tag 取 `v<topbar 版本>`，附上 `dist/topbar-controls.js` 和 `dist/home-feed-filter.js`）。

注意事项：

- 本地也可手动自增：`node scripts/bump-version.cjs`（`--dry-run` 只看不改）。
- Release 的 tag 会跟着 topbar-controls 的版本走；如果只想发布首页模块的更新，也仍是同一个 Release
  （body 里写清了两个模块各自的版本号）。
- 首次推送前，GitHub 仓库的 `Settings → Actions → General` 里要允许 workflow 有写权限：
  `Workflow permissions` 选 **Read and write permissions**（否则自增后的 `git push` 会失败）。

## 三条硬约束（踩过的坑，新增模块也必须遵守）

1. **产物必须是单文件 IIFE**。BE 用 `Function('window', 'with (window) { return eval(code) }')` 执行脚本，with 对象的
   `has` 恒为 true，任何顶层标识符（含 `function` 声明）都会被拦成 `undefined`。IIFE 让内部标识符先命中自身作用域。
2. **不要在源码里写 `exports.component = ...`**。esbuild 会据此判定为 CommonJS，把整个文件包进
   `__commonJS`，赋值落到内部假 exports 上，沙箱拿到的还是空对象。正确做法：`format: 'iife'` + `globalName` +
   footer 写入 `exports`（见 `build.mjs`）。
3. **BE 的 `OptionMetadata`
   没有分组能力**（FeatureOptions.vue 是一层平铺 v-for）。分组只能靠「名称前缀 + 写入顺序」：`Object.assign`
   的顺序就是面板里的顺序。
