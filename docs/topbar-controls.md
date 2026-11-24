# 顶栏控件管理 —— Bilibili Evolved 自定义组件 v3.7.3

动态扫描 B 站顶栏的所有控件，每个控件一个开关，直接嵌在 **BE 设置面板**里。

---

## v3.7.x 修的两个问题

### 1. 左边按钮区 GAP 调不动

`.bili-header__menu` 和 `.bili-header__bar` **是同一个 div**：

```html
<div class="bili-header__menu is-zh bili-header__bar" data-v-3380389d></div>
```

所以「按钮区之间的间距」滑杆（样式表 `padding-left:Npx!important`）和 v3.5.x 的运行时校准
（内联 `bar.style.setProperty('padding-left', …)`）打的是同一个属性、同一个元素。
**内联 `!important` 永远压过样式表 `!important`**，滑杆从此彻底失效；而且校准读
`getComputedStyle` 读到的是自己被钉住的值，delta 恒为 0，再也不会更新 —— 左边就"卡死"了。

v3.6.0 把两件事拆开，各管各的属性：

| 谁                       | 属性                         | 落地位置               |
| ------------------------ | ---------------------------- | ---------------------- |
| 「按钮区之间的间距」滑杆 | `padding-left/right` + `gap` | 样式表规则             |
| 左右边缘校准             | **`margin-left`**            | `.left-entry` 内联样式 |

校准改成**增量累加**（`alignOffset += delta`，收敛后 delta≈0），正负都跟随，
收敛区间 `[-30px, 72px]`。另外 `apply()` 里只"补写"存量偏移、不测量 ——
顶栏下滑会重建节点，内联 margin 会丢，但测量绝不能进 MutationObserver。

### 2. 固定状态下头像消失（v3.7.3）

真正原因不是动画，是**我们把头像当成普通顶栏项隐藏了**。

定位过程：让用户在头像消失时执行 `__bhc__.avatar()`，输出里 `mini` / `big` / `img`
三层的 `display / visibility / opacity` 全是正常的（`block / visible / 1`），但
`box` 是 `0x0`、`at` 是 `0,0`，再看祖先链：

```
div.header-avatar-wrap--container {d:flex,v:visible,o:1,z:10}   ← 我们钉的
div.v-popover-wrap                {d:block,...}
div.header-avatar-wrap            {d:none,...}                  ← 罪魁
div.right-entry__main             {d:flex,...}
div.right-entry                   {d:block,...}
```

`.header-avatar-wrap` 被 `display:none` 了，而 B 站 CSS 里它只有 `position:relative`
（全表只有一条），所以这个 `none` 是 `hideEl()` 写的内联样式。

链路：头像项 `<div class="header-avatar-wrap right-entry__item">` 满足
`/entry__item$/`，被扫进控件列表 → 它的 key 由链接 `//space.bilibili.com/{mid}`
推导 → **大顶栏 / mini 两态下 DOM 包裹层不同，序号漂移，同一个 key 会绑到不同元素** →
某一态下该 key 恰好是 `false`（历史遗留配置）→ `hideEl()` 给整块头像写 `display:none`，
账号入口一起消失；换回另一态 key 又对上了别的项，于是"回到顶部又出现"。

修法（v3.7.1 → v3.7.3）：

1. **扫描层**：`scan.ts` 新增 `isAccountItem()`，`.header-avatar-wrap` 及含
   `.header-entry-mini` / `.header-entry-avatar` 的项**从扫描结果里剔除**，
   设置面板里不再出现这个开关；`apply()` 里再加一道硬保护，命中头像就不隐藏。
2. **样式层**：`buildHiddenCss` 生成的每条 `:has()` 规则都加 `KEEP_AVATAR`
   （`:not(.header-avatar-wrap):not(:has(.header-avatar-wrap))`）。
   头像容器自己带 `right-entry__item` 类名、弹层里还有一堆 space / member 链接，
   很容易被别的项的规则连带命中 —— 这类规则是静态的，命中就是全状态消失。
   注意 `:has()` 只查后代不查自身，所以 `.header-avatar-wrap` 那半截必须单独写。
3. **兜底层（有边界）**：
   - `header-avatar-wrap:not(#bhc-keep):not(:has(.mini-avatar--large)){display:block!important;...}`
     —— `#bhc-keep` 是纯特异性放大器（页面上不存在这个 id，选择器恒匹配，
     但凭空多一个 (1,0,0)），用来压过 B 站懒加载 CSS 里可能的 `display:none`；
     **刻意排除 `--large`**（hover 放大态）。
   - 运行期 `protectAvatar()`：每次 apply 清掉头像上的 `data-bhc-hidden` /
     内联 `display:none`，同样跳过 `--large` 态。

**为什么必须排除 `--large`**：那个状态下 B 站要让小头像 `fadeOut`、由弹层里的
80px `.big-avatar` 接替 —— 这是原生交互。把可见性钉死就会变成
"hover 放大时原位多了一个"（v3.7.2 的实测反馈）。

另外缓存 key 升到 `bhc:items:v5`，作废旧缓存里那条幽灵记录。

只保留的尺寸约束（防 VImg 的 60×60 溢出/抖动，不参与上面的 bug）：

```css
.header-avatar-wrap--container .header-entry-mini .v-img,
.header-avatar-wrap--container .header-entry-mini img {
  width: 38px;
  height: 38px;
  box-sizing: border-box;
  object-fit: cover;
  border-radius: 50%;
}
```

结构备查（`index-a5f8e5ab.js` 原文）：

```html
<div class="header-avatar-wrap ...">
  <div class="v-popover-wrap">
    <div class="header-avatar-wrap--container mini-avatar--init|small|large">
      <a class="header-entry-mini"><VImg src="face" width="60" height="60" /></a>
      <a class="header-entry-avatar"></a>
      <!-- children 是 null，空热区 -->
    </div>
  </div>
</div>
```

头像只有一份真身（`.header-entry-mini` 里的 `VImg`）；`.header-entry-avatar` 是空热区，
它的 `avatarFadeSmall/Large` 只改热区大小，不产生画面。

## 左右边缘不对称的历史排查（v3.2 → v3.5）

现象：不动任何设置，**右侧最后一个按钮的可见内容到窗口边缘，比左侧第一个按钮远得多**（约等于翻倍）。

### 增量排查过程

| 版本   | 判断                                              | 结果                                                         |
| ------ | ------------------------------------------------- | ------------------------------------------------------------ |
| v3.2.1 | 最后一项 `:last-child` 归零失效（末尾有占位节点） | 只补了 8px，仍不对称                                         |
| v3.3.0 | 头像容器 `margin-right:10px` 是元凶，CSS 归零     | **错**：那 10px 是头像和"消息"之间的间距，归零后两者贴在一起 |
| v3.4.0 | 用真实浏览器实测（Chrome + puppeteer）            | 找到真正原因                                                 |
| v3.5.1 | 只移动左侧（`padding-left`）                      | 对称了，但把滑杆锁死                                         |
| v3.6.0 | 改走 `.left-entry` 的 `margin-left`               | 两者互不干扰                                                 |
| v3.6.0 | 顺手"接管"头像（`transform:none`）                | **错**：把 100px 原尺寸放了出来，头像变巨大，v3.6.1 撤销     |

### 为什么不能放进 MutationObserver（v3.4.1 修复的 hover 闪烁）

第一版把 `normalizeRightInset()` 放在 `apply()` 里，而 `apply()` 由 `MutationObserver` 驱动。
后果是一个反馈环：

```
hover 头像 → B 站插入弹层(触发 mutation) → apply() → 改 padding-right
          → 右侧按钮横移几像素 → 鼠标脱离头像 → 弹层关闭(又一次 mutation)
          → padding 改回去 → 又触发…… 来回震荡
```

现在校准只在这几个时机跑：

- 首屏（rAF 一次 + 600ms 一次，等字体和头像加载完）
- `window.resize`
- 设置项变化（隐藏控件会改变右边缘）

另外 `normalizeRightInset()` 开头会检查 `right.matches(':hover')`，鼠标停在右侧时直接跳过。

### 真正的原因（2560 宽实测）

```
未干预： gapLeft = 24px   gapRight = 44px
```

其中 20px 不是 margin，而是**最后一项自己的内边距**。以"投稿"按钮为例：

```
.right-upload-entry 盒子右边缘 = 1416   (1440 - 24，完全贴边)
   └─ 内部 trigger-text 右边缘 = 1397   (还差 19px)
```

也就是说盒子是贴边的，但**盒子里的图标和文字**距离边缘还有 20px。左侧第一个项是纯文字链接，没有这层内边距，所以：
左边看到的 24px vs 右边看到的 44px，正好接近翻倍。

另外滚动条也会贡献：固定栏贴的是内容区右边缘，而人眼看的是窗口右边缘，中间还隔着整条滚动条（约 17px）。

### 做法：只移动左侧，右侧一动不动

```js
gapLeft  = 第一个可见按钮的左边缘
gapRight = innerWidth - 右侧最右"可见叶子"的右边缘
alignOffset += (gapRight - gapLeft)   // 落到 .left-entry 的 margin-left
```

这样做的代价是左侧导航整体右移约 20px（看起来和右侧居中对称），但右侧的所有
交互元素（头像、投稿、各弹层）锚点保持不变，没有 hover 副作用。

几个实现要点：

- **量叶子，不量盒子**。`.right-entry__main`、`.right-entry__item` 撑满整行，
  `getBoundingClientRect` 永远等于内容区边缘，量不出按钮内部的 20px 内边距。
- **过滤隐藏元素**。B 站弹层用 `visibility:hidden` / `opacity:0`，尺寸还在，不过滤会算错。
- **以 `innerWidth` 为基准**，滚动条宽度自动纳入。
- 只在首屏（rAF + 600ms）、`resize`、改设置时校准，**不放进 MutationObserver**
  （否则会和 hover 弹层互相触发，形成震荡）。
- 提供开关「左右边缘对齐」，关掉就完全回到 B 站原始内边距。

实测（2560 宽）：

```
未干预：   gapLeft 24    gapRight 44
校准后：   gapLeft 44    gapRight 44    (.left-entry margin-left:20px，padding 仍是 24px)
```

### 关于头像那 10px

`.header-avatar-wrap--container { margin-right: 10px }` 是**头像与"消息"之间的间距**，不是边缘留白。v3.3.0 把它归零导致"头像贴住消息"，v3.4.0 已移除该规则。

## 两个分类 & 按"项"扫描（v3.2.0）

### 1. 选项分成「显隐」和「其它」

BE 的 `OptionMetadata` **没有分组能力**：`FeatureOptions.vue` 就是一层平铺的 `v-for`，
只认 `hidden`（隐藏单项）和 `extraOptions`（需要传 Vue 组件构造器，沙箱里拿不到），
没有 group / divider / 折叠这类字段。

所以分类靠**名称前缀 + 排列顺序**做出来：

```
显隐 · Logo（固定顶栏）
显隐 · 首页
显隐 · 番剧
…
其它 · 按钮之间的间距 (-1 = 默认)
其它 · 按钮区之间的间距 (-1 = 默认)
其它 · 显示「插件影响」提示条
其它 · 显示滚动时固定的分区栏
其它 · 顶栏显隐动画
其它 · 顶栏常驻顶部（无滑入滑出）
```

`Object.assign` 先写显隐、再写其它，`Object.entries` 的顺序就是面板顺序，所以两组天然分开。

### 2. 扫描方式改成"按项"，不再"按层级"

v3.1.1 把扫描根从 `.left-entry-main` 改成 `.left-entry`（为了抓 Logo），
但沿用了"直接子元素 + 遇到 `entry-main` 展开一层"的写法。结果 B 站只要在右侧
多包一层包裹节点（投稿那一片经常这样），整片就只剩一个"项"，**投稿、消息、动态全丢**。

现在按类名抓，与层级无关：

```ts
// 1. 取所有类名以 entry__item 结尾的后代
root.querySelectorAll('[class*="entry__item"]')
// 2. 跳过 .left-entry-fake-triggers 里那份测宽用的影子副本
// 3. 去掉嵌套重复（项里套项只留外层）
// 4. 一个都没抓到才退回直接子元素
```

判断用 `entry__item$`（token 结尾），所以 `left-entry__item`、`right-entry__item` 命中，
而 `left-entry__item-trigger` 这种子元素不会被误当成控件。

## 工程化（v3.0.0：TypeScript + esbuild）

最早是 600 多行手写单文件。现在是 TS 多模块仓库里的一个模块，产物仍是**单文件**，粘贴方式和以前完全一样。

```
dist/topbar-controls.js           ← 构建产物（不要手改）
build.mjs                         多模块构建（见仓库根 README）
src/
  shared/
    types.ts                      BE 组件类型的最小定义
    util.ts                       hash / slug / href 处理
  modules/topbar-controls/
    types.ts                      模块专有类型（TopbarItem / CachedItem）
    scan.ts                       顶栏扫描（找根容器、取控件、生成 key、排除头像）
    cache.ts                      localStorage 缓存（右侧未渲染时兜底）
    styles.ts                     CSS 生成（隐藏 / 间距 / 其它 / 头像保活）
    index.ts                      组件定义 + entry 生命周期
```

### 命令

```bash
npm install          # 首次
npm run build        # 构建全部模块 → dist/*.js
npm run check        # tsc 类型检查
npm run dev          # watch + 本地服务器（5178）
```

### dev 模式怎么做热更新

`npm run dev` 会启动 `http://localhost:5178/topbar-controls.js`（产物目录 `dist/` 直接挂在根路径）
并持续 watch。把 BE 设置面板的安装方式换成「从链接安装」，填这个地址，之后改源码保存 → 刷新页面就是新代码，不用反复复制粘贴。

（BE 的 `installFeatureFromCode` 支持传入 URL，会自动识别 `entry` 走组件安装。）

### 三个构建上的坑

**1. 产物必须是 IIFE**

BE 用 `with (window) { eval(code) }` 执行，而 with 对象的 `has` 恒为 true，顶层 `function foo(){}` 会被解析成
`window.foo`（undefined）。esbuild 的 `format: 'iife'` 正好解决。

**2. 不能直接写 `exports.component = ...`**

一旦源码里出现 `exports`，esbuild 会认定这是 CommonJS 模块，把文件包进
`__commonJS({ "src/index.ts"(exports) { ... } })`。`exports.component`
赋到了那个假对象上，**沙箱注入的 exports 依然是空对象**，BE 报「无效的功能代码」。

改用 `globalName` + footer：

```js
// build.mjs
globalName: 'bhcBundle',
footer: { js: 'exports.component = bhcBundle.component;
bhcBundle.component;' },
```

footer 是原样追加、不参与模块分析，所以这里的 `exports` 会正常落到沙箱对象上；最后一行作为 eval 返回值做双重保险。

**3. `"use strict"` 是 esbuild 自动加的**

TS 输出被视为 ESM，esbuild 会在 IIFE 外加一行 `"use strict"`。实测这个严格模式**不会**影响通过 with 访问 `exports` /
`unsafeWindow`（标识符查找照常沿作用域链走），但如果你以后手动往产物里塞依赖 `with` 的代码，会直接语法报错。

### 验证方式

用 BE 相同的沙箱方式跑产物（`Function('window', 'with (window) { return eval(code) }')`），断言：

```
✅ exports 注入成功          ✅ 控件开关 6 项
✅ 隐藏 2 个控件             ✅ CSS 含隐藏/间距/pinHeader
✅ __bhc__ 已挂载            ✅ 与单文件版行为一致
```

## Logo 项 & "开关点了没反应"（v3.1.1）

### 1. 固定顶栏时的 Logo 现在也在列表里

B 站 mini / 固定状态会在左侧显示一个 bilibili Logo，它是 `<div class="big-logo">`（Vue 组件 `BigLogo`，
`data-v-76544956`），包在一个 `.left-entry__item` 里，**并且和"首页"共用同一个链接** `//www.bilibili.com`。

之前扫不到它，原因有两个：

- 扫描根取的是 `.left-entry-main`，而 Logo 项是 `.left-entry` 的直接子级，在 `.left-entry-main` 外面
- 即使扫到了，它是"首页"链接的前缀，`hrefOp` 逻辑会把它和首页混为一谈

现在：

| 项目     | 处理                                                                                                        |
| -------- | ----------------------------------------------------------------------------------------------------------- |
| 扫描根   | 改用 `.left-entry`，遇到 `.left-entry-main` 才向下展开一层；`.left-entry-fake-triggers`（测宽影子节点）过滤 |
| key      | 固定为 `left_logo`，不和首页抢                                                                              |
| 名称     | 有文字时 `xxx（Logo 图标）`，无文字时 `Logo（固定顶栏时显示）`                                              |
| 隐藏     | 直接命中 `${SCOPE} .big-logo`，比 `:has()` 更稳                                                             |
| 互不影响 | 所有链接规则都加了 `:not(:has([class*="logo"]))`，隐藏"首页"不会连带 Logo，反之亦然                         |

### 2. 开关点了没反应 → 内联样式兜底

**a. 内联 `display:none !important`**

原来只加 `data-bhc-hidden` 属性，靠 `[data-bhc-hidden]{display:none!important}` 生效。
这个选择器特异性只有 `(0,1,0)`，一旦 B 站自己也有 `display:...!important` 且特异性更高就会被压住。

现在同时写内联样式：

```js
el.style.setProperty('display', 'none', 'important')
```

内联 `!important` 的优先级高于任何外部样式表，这条路径没有输的可能。原值存在 `WeakMap` 里，卸载/重新应用时精确还原。

**b. 不会自动删你的开关**

曾经试过"把扫不到的 `show_*` 从选项里删掉"，**已废弃**。
真正原因是旧版本组件没卸干净，两个版本同时在改顶栏；靠删选项只会把正常配置一起删掉。
现在选项只增不减，扫描不到时最多不生效，绝不悄悄移除。

**c. 控制台会告诉你哪个开关失效了**

```js
console.warn('[顶栏控件管理] 以下开关已关闭但没匹配到当前控件，可能已失效：', orphan)
```

## 为什么 v1 没有配置界面

不是选择器的问题，是**我选错了功能类型**。BE 的两种扩展点完全不同：

|                    | 插件 `PluginMinimalData`             | 组件 `ComponentMetadata`                  |
| ------------------ | ------------------------------------ | ----------------------------------------- |
| 必填               | `name` + `setup`                     | `name` + `displayName` + `tags` + `entry` |
| 配置项 `options`   | ❌ **没有这个字段**                  | ✅ 有，设置面板自动渲染成开关             |
| 出现在设置面板左侧 | 只在「插件」列表里一行，点进去无内容 | ✅ 作为独立条目，右侧是选项 UI            |

源码依据（`src/plugins/plugin.ts`）：

```ts
export interface PluginSetupParameters {
  coreApis
  addData
  addHook
  registerData
  registerAndGetData
  getHook
}
export interface PluginMinimalData extends FeatureBase {
  setup: (params: PluginSetupParameters) => void | Promise<void>
  name: string
  displayName?: string
}
```

`setup` 的参数里**没有任何注册 UI 的接口**，`PluginMinimalData` 也没有
`options`。所以插件永远不可能有配置界面——这正是你看到「没有可配置项、没有 UI」的根本原因，v1 那个悬浮面板是我自己用 DOM 硬画的，注定游离在 BE 之外。

组件才有 `options`，而且 `installFeatureFromCode` 会自动识别类型：

```ts
// src/core/install-feature.ts
const isComponent = item => typeof item?.entry === 'function'
const isPlugin = item => typeof item?.setup === 'function'
```

所以 v2 把类型换成组件，同一个安装入口粘贴，BE 会自动走 `installComponent`。

---

## 装法

1. **先移除旧插件**：设置面板 → 插件 → `顶栏控件管理` → 移除（否则 v1 的悬浮球还会在）
2. 打开 `dist/topbar-controls.js`，**全选复制**
3. 设置面板 → 找「安装自定义组件 / 从代码安装」入口（就是之前装插件那一个，一样粘贴）
4. 刷新页面

装完在设置面板左侧会多出 **「顶栏控件管理」**（标签：工具），点进去右侧是：

```
顶栏控件管理                       [总开关]
─────────────────────────────
选项
 ┌ 首页                      ●
 ├ 番剧                      ●
 ├ 直播                      ●
 ├ 游戏中心                   ●
 ├ 会员购                     ●
 ├ 漫画                      ●
 ├ 赛事                      ●
 ├ 下载客户端                  ●
 ├ message.bilibili.com      ●
 ├ space.bilibili.com        ●
 └ ...
```

**开关默认全部打开 = 控件正常显示；关掉某个开关 = 隐藏该控件。** 关掉组件总开关等同于全部恢复。

选项的取值存在 BE 自己的设置里（`userComponents.topbarControls.settings.options`），所以**会跟着 BE 的设置导入导出一起走**，换设备不用重新配。

---

## 为什么叫“动态”

没有任何硬编码的控件名单。三层机制：

1. **生成选项时扫描一次** —— 代码执行时读 `.bili-header` 下的 `.left-entry-main` 和
   `.right-entry`，取它们的**直接子元素**，每个生成一个 `options` 项。名称优先取可见文字，没有文字的图标项退回 `title`
   / 链接路径（如 `message.bilibili.com`）
2. **结果写入 localStorage**（`bhc:items:v3`）—— 因为 B 站顶栏右侧是客户端渲染的，页面刚加载时可能还是空的；有了缓存，下次启动即使 DOM 未就绪也能照常生成完整选项
3. **运行时持续补全** —— `MutationObserver` 盯着整个 body（250ms 节流），发现新控件就补进 `options`
   并写回缓存，控制台会提示，重开面板即可看到

key 用链接地址生成（`left_www_bilibili_com_anime`），所以 B 站调整顺序不会让配置错位；纯图标按钮没有链接，退化用「类名 + 内容哈希」。

隐藏方式是给控件加 `data-bhc-hidden` 属性，配合 `instantStyles` 注入的
`display:none !important`——组件关掉时样式自动移除，控件立刻回来。

---

## 下滑时控件会闪一下（v2.2.0 修复）

现象：关掉「首页」后，页面正常；但**向下滚动、顶栏收成 mini 形态的瞬间，「首页」会露一下再消失**。

原因不在动画本身，而在于 mini 形态是**另一套被重建的节点**。之前隐藏完全依赖 `data-bhc-hidden` 属性 +
250ms 节流的 MutationObserver：新节点上没有属性 → 短暂可见 → 轮询补上 → 消失。人眼看到的“闪现”就是这么来的。

修复成两层：

| 层   | 手段                         | 时机                                    |
| ---- | ---------------------------- | --------------------------------------- |
| 主   | 动态 `<style>` 注入 CSS 规则 | **常驻生效**，节点怎么重建都命中        |
| 兜底 | `data-bhc-hidden` 属性       | 无链接的图标项、`:has()` 不支持的浏览器 |

生成的规则形如：

```css
:is(.bili-header, .international-header) :has(> a[href='//www.bilibili.com']),
:is(.bili-header, .international-header) [class*='entry__item']:has(a[href='//www.bilibili.com']) {
  display: none !important;
}
```

两个细节：

- **链接匹配分精确 / 前缀两种**。首页的 href 是 `//www.bilibili.com`，它是番剧、直播等所有同域链接的前缀，用 `^=`
  会连带隐藏一整排，所以自动降级为 `=`；番剧、漫画这类用 `^=`，顺带兼容 query 变化（规则里已去掉 `?from=...`）。
- **第二选择器限定 `[class*="entry__item"]`**，防止 `:has()` 在 mini 结构里多包一层时选不到，同时避免匹配到
  `.left-entry-main` 这种把整排控件一起隐藏的祖先。

另外把 MutationObserver 的 250ms 定时器换成了 `requestAnimationFrame`，无链接的图标项最多只会在同一帧内补上。

## 间距调整（v2.4.1，2 个滑杆）

| 选项                 | 范围    | 作用                                                                  |
| -------------------- | ------- | --------------------------------------------------------------------- |
| **按钮之间的间距**   | -1 ~ 40 | 左右所有 `.left-entry__item` / `.right-entry__item` 的 `margin-right` |
| **按钮区之间的间距** | -1 ~ 80 | 一个滑杆同时控制三处距离，见下表                                      |

`-1` = 不干预，一条规则都不注入（默认值）。

### 一个滑杆管三个距离

| 位置              | 实现                                                   |
| ----------------- | ------------------------------------------------------ |
| 按钮 ↔ 左/右边缘  | `.bili-header__bar` 的 `padding-left/right`（原 24px） |
| 左按钮区 ↔ 搜索框 | flex `gap`                                             |
| 搜索框 ↔ 右按钮区 | 同上                                                   |

拖动时的实际数值（实测输出）：

| 滑杆值 | gap  | 左右 padding | 搜索框宽度 |
| ------ | ---- | ------------ | ---------- |
| 0      | 0px  | 0px          | 500px      |
| 24     | 24px | 24px         | 452px      |
| 60     | 60px | 60px         | 380px      |

### 为什么前面两版都“没效果”

**v2.3 — 改 `.left-entry { margin-right }`**：无效。布局是 `display:flex; justify-content:space-between`，搜索栏
`.menu-center` 带
`flex-grow: 1`，会吃掉全部剩余空间。给左右区域加 margin 只让中间可用空间小一点，中间本来就撑满，**零位移**。

**v2.4 — 改 `.menu-center { margin }` + 缩小 `max-width`**：只解决了“按钮到搜索框”。因为
`.center-search-container.menu-center` 里面还有一层
`.center-search__bar { margin: 0 auto; max-width: 500px }`，输入框始终居中，容器 margin 变了、剩余空间重新均分，位置又回到原处。而
**按钮到左右边缘的距离根本不在 margin 上，是 `.bili-header__bar` 的 `padding: 0 24px`**，我压根没碰它，自然没反应。

**v2.4.1 — 全面接管**：既然三处距离分属 padding / gap / max-width 三个不同属性，干脆用 flex 明确接管：

```css
:is(.bili-header, .international-header) .bili-header__menu {
  display: flex !important;
  align-items: center !important;
  justify-content: space-between !important;
  gap: 24px !important;
  padding-left: 24px !important;
  padding-right: 24px !important;
}
/* 原本 margin: 0 50px 会和 gap 叠加, 归零 */
:is(.bili-header, .international-header) .bili-header__menu .menu-center {
  margin-left: 0 !important;
  margin-right: 0 !important;
}
:is(.bili-header, .international-header) .center-search__bar {
  max-width: 452px !important;
}
```

### 一个副作用要知道

滑杆会**同时**作用于 `.menu-center`
的间距和搜索框宽度，所以视觉上的“按钮区间距”变化约等于滑杆值的两倍。这是刻意的——只调 gap 的话，搜索框内部两侧的空白不变，看起来仍然很挤。

## 隐藏「插件影响」提示条（v2.5.0）

B 站检测到 AdBlock 类插件时，会在视频卡片顶部渲染一条橙色横幅：

> 检测到您的页面展示可能受到浏览器插件影响，建议您将当前页面加入插件白名单，以保障您的浏览体验

开关在选项最后一项 **「显示「插件影响」提示条」**，默认开启。关掉后注入：

```css
.adblock-tips {
  display: none !important;
}
```

### 类名是从 bundle 里挖出来的

首页 HTML 里没有这个东西（它是运行时条件渲染的），直接抓 DOM 抓不到。我在前端 bundle
`laputa-home/assets/index-a5f8e5ab.js` 里定位到了它的渲染代码：

```js
SD = { key: 0, class: 'adblock-tips' }
// ...
r.showTip
  ? h('div', SD, [
      h('p', null, r.t('adBlockTips', '检测到您的页面展示可能受到浏览器插件影响…')),
      h('img', { alt: 'close', onClick: r.closeTip }),
    ])
  : null
```

对应的样式（`index-c9d9cd12.css`）：

```css
.adblock-tips {
  width: 100%;
  height: 30px;
  line-height: 30px;
  padding: 0 30px;
  background: #fff0e3;
  color: #e58900;
  display: flex;
  justify-content: center;
  align-items: center;
}
```

整个 bundle 里 `adblock` 相关类名**只有这一个**，所以规则不用加前缀限定，直接隐藏即可。

### 说明

- 这是**纯视觉隐藏**，B 站的检测逻辑照常运行，推荐流该少的还是会少。
- 默认开启（显示），不动它就是原样；想收起时关掉开关，立即生效。
- 同时被屏蔽的还有一条同源文案「该内容被 AdGuard/AdBlock 类插件屏蔽 / 请检查插件以恢复正常内容展示」，它们属于同一组提示，类名相同。

## 隐藏滚动时固定的分区栏（v2.6.0）

B 站首页往下滚动后，顶栏下方会浮出一条固定的分区栏（番剧/国创/综艺…）。开关是列表里最后一项
**「显示滚动时固定的分区栏」**，默认开，关掉即消失。

```css
.header-channel {
  display: none !important;
}
```

### 为什么不是隐藏 `.header-channel-fixed`

你说的 `header-channel-fixed is-zh` 是**内层容器**。看线上样式，外层才是那个固定条：

```css
.header-channel {
  position: fixed; top: 63px; z-index: 1001;
  width: 100%; display: flex; justify-content: center;
  background: var(--bg1_float); box-shadow: 0 2px 4px rgba(0,0,0,.08);
  animation: fixedTopBarSlideDown .2s linear forwards;
}
.header-channel .header-channel-fixed.is-zh .header-channel-fixed-right { ... }
```

只隐藏 `.header-channel-fixed` 的话，外层的 `fixed`
定位、白底、阴影都还在，你会看到**一条 63px 的空白条**继续压在内容上。所以规则落在 `.header-channel`。

### 不会误伤顶栏里的分区

页面里有两个同类东西，别搞混：

| 类名                    | 位置                                  | 是否受影响 |
| ----------------------- | ------------------------------------- | ---------- |
| `.bili-header__channel` | 顶栏内部，页面顶部那条分区栏          | ❌ 不动    |
| `.header-channel`       | 滚动后 `position: fixed` 浮出来的那条 | ✅ 隐藏    |

它们的类名不同，规则只命中后者。

## 去掉顶栏显隐动画（v2.7.0）

开关：**「顶栏显隐动画」**，默认开。关掉后注入：

```css
.bili-header.bili-header--slide-down .bili-header__bar,
.header-channel {
  animation: none !important;
  transition: none !important;
}
```

B 站顶栏滚动时有两段动画（从线上 CSS 里挖出来的）：

| 元素                                         | 动画                   | 时长        |
| -------------------------------------------- | ---------------------- | ----------- |
| `.bili-header--slide-down .bili-header__bar` | `biliHeaderSlideDown`  | 0.3s linear |
| `.header-channel`                            | `fixedTopBarSlideDown` | 0.2s linear |

关掉后顶栏**瞬间出现/消失**，不再有滑动过程，配合「隐藏固定分区栏」使用效果最明显——滚动时顶部不会再有东西滑进来。

顺带说明：`transition: none`
一起禁掉是必要的，顶栏容器除了 animation 还有位置/阴影的过渡，只关 animation 时仍可能看到残留的位移。

## 顶栏常驻顶部 + 背景渐变（v2.8.1，默认开启）

不用“去掉动画”，直接从根上让顶栏没有进入/退出状态——常驻 `position: fixed; top: 0`，永远不会滑入滑出。

```css
/* 1. 钉住 */
:is(.bili-header, .international-header) .bili-header__bar {
  position: fixed !important;
  top: 0 !important;
  animation: none !important;
  z-index: 1002 !important;
}
/* 2. 用伪元素做背景, 才能渐变 */
:is(.bili-header, .international-header) .bili-header__bar::after {
  content: '';
  position: absolute;
  inset: 0;
  z-index: -1;
  background: var(--bg1_float);
  opacity: 0;
  pointer-events: none;
  transition:
    opacity 0.3s ease,
    box-shadow 0.3s ease;
}
/* 3. 滚动状态自己不再直接换背景, 交给蒙版 */
:is(...).bili-header--mini .bili-header__bar,
:is(...).bili-header--fixed .bili-header__bar,
:is(...).bili-header--slide-down .bili-header__bar {
  background: transparent !important;
  box-shadow: none !important;
}
/* 4. 蒙版淡入 */
:is(...).bili-header--mini .bili-header__bar::after,
:is(...).bili-header--fixed .bili-header__bar::after,
:is(...).bili-header--slide-down .bili-header__bar::after {
  opacity: 1;
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.08);
}
```

### 为什么要加伪元素

B 站是直接切 `background`（首屏 `linear-gradient(...)`，滚动后 `var(--bg1_float)`）。`background` 简写里含渐变，CSS
**无法在两种渐变之间插值**，所以无论加多少 `transition` 都是瞬间跳变——这就是“生硬”的原因。

改成一层 `::after` 白色蒙版，用 `opacity` 做过渡。`opacity` 是可动画属性，0 →
1 平滑淡入，位置完全没有位移，不违背“无动画”的诉求。

`z-index: -1` 让蒙版垫在内容下面；`.bili-header__bar` 本身背景设成
`transparent`，蒙版才可见（父元素有不透明背景时，负层级子元素会被挡住）。

首屏 `--transparent` 状态**不覆盖**，仍用 B 站自带的深色渐变，保证白色文字在 banner 上可读。

### 修掉的两个坑

- `${pinned}::after` 整体拼接时，`::after` 只加在最后一个选择器上，前两个状态拿不到蒙版——改成逐个选择器分别拼接。
- 状态选择器一度写成
  `:is(.bili-header).bili-header--mini :is(.bili-header) .bili-header__bar`，这要求“header 里再套一个 header”，**永远匹配不上**。状态类是加在
  `.bili-header` 自身上的，`bar` 是它的直接子级，不能再套一层 scope。

## 一个必须知道的沙箱限制（v2.0.1 修复的错误）

v2.0.0 装上后报错：

```
TypeError: scanNow is not a function
at Object.run (userscript.html?...)
at async browse (...)
```

原因是 BE 执行代码的方式（`src/core/external-input/load-feature-code.ts`）：

```ts
const sandbox = new Proxy(Object.create(null), {
  has: () => true, // ← 关键
  get: (_, p) => (injection.has(p) ? injection.get(p) : window[p]),
})
Function('window', `with (window) { return eval(code) }`).bind(undefined, sandbox)
```

`with` 对象的 `has` **恒为 true**，等于声称“我拥有所有属性”。JS 作用域查找在 `with` 处就命中了（返回
`undefined`），不会再往外找。所以**顶层 `function foo(){}` 全部失效**，调用时变成 `window.foo` = undefined。

`const` / `let` 不受影响，因为它们在 eval 的词法环境里，比 `with` 更靠内层。

修复方式是给整段代码包一层 **IIFE**：

```js
;(function () {
  // 所有 const / function 定义都在这里
  exports.component = component
})()
```

这样内部标识符查找会先命中 IIFE 自身的函数作用域，不会漏到 `with` 上。BE 官方插件编译出来的 UMD 也是这个结构，道理相同。

**改这个文件时的约束**：不要把顶层代码写到 IIFE 外面，否则同样的错误会复现。

---

## 限制

- **右侧控件在首次安装时才能被扫到**。因为首屏 HTML 里 `.right-entry`
  是空的，如果你在页面加载极早期就打开了设置面板，右侧项会缺失；刷新一次就正常。
- **不同子域的缓存独立**（`www` / `search` / `message`
  的 localStorage 隔离）。第一次进某个子域时会重新扫描，选项可能比主站少。
- **纯图标项（右侧无链接的按钮）没有 CSS 兜底**，节点重建时可能闪 1 帧；有链接的项不受影响。
- **隐藏只是
  `display:none`**，控件仍在 DOM 里，其网络请求和数据逻辑照常运行（比如消息红点仍在统计）。这是刻意保留的，避免引发副作用。
- 纯图标项的显示名是域名或 `右侧图标 N`，不好认的话可以用控制台 `__bhc__.scan()` 对照。

---

## 调试

```js
__bhc__.scan() // 当前扫到的控件：[{ key, label, side }]
__bhc__.items() // 生成选项时的清单
__bhc__.apply() // 手动重新应用一次
__bhc__.clear() // 清空缓存，下次加载重新扫描
```

控制台加载时应有一行：

```
[顶栏控件管理] v2.8.1 已加载, 共 8 个控件
```

如果显示「来自缓存, 等待顶栏渲染」，说明代码执行时 DOM 还没出来，属于正常现象——`entry` 运行时会把实时结果补上。
