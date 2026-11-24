# 首页推荐过滤（home-feed-filter）

按类型隐藏 B 站首页推荐流里的卡片。**只做隐藏**，不排序、不改布局 —— 隐藏后剩下的卡片自然回填，
无限滚动会继续往下加载。

产物：`dist/home-feed-filter.js`（v1.4.0）

## 开关

默认**全部关闭**：组件本身是启用的，但不勾任何一类时行为与原生完全一致，装上不会突然少东西。
设置面板里每个类型一个开关，名称统一前缀「过滤 · 」：

| 开关          | 判据                                                                   |
| ------------- | ---------------------------------------------------------------------- |
| 过滤 · 直播   | 链接命中 `live.bilibili.com`，或角标含「直播」                         |
| 过滤 · 纪录片 | 角标含「纪录片 / 纪录」                                                |
| 过滤 · 电影   | 角标含「电影」                                                         |
| 过滤 · 国创   | 角标含「国创」                                                         |
| 过滤 · 综艺   | 角标含「综艺」                                                         |
| 过滤 · 电视剧 | 角标含「电视剧 / 连续剧」                                              |
| 过滤 · 番剧   | 角标含「番剧 / 动画」，或链接含 `/bangumi/` 但无角标（PGC 兜底档）     |
| 过滤 · 课程   | 链接含 `/cheese/`，或角标含「课程 / 课堂」                             |
| 过滤 · 广告   | 链接含 `cm.bilibili.com`、卡片带 `is-rcmd` 类，或角标含「广告 / 推广」 |

## 判定链路（v1.4.0）

```
1. data-goto / data-type 属性
2. 卡片结构：.bili-live-card / [class*="live-card"] → 直播，[class*="cheese-card"] → 课程
3. 角标 class 命中（icon-text / badge / tag / label / corner，可 includes）
4. 链接：live.bilibili.com → 直播，/cheese/ → 课程
5. 文本节点扫描：任何 ≤4 字的文本节点整体等于类型词即命中
   （跳过 stats / up- / desc / info--bottom 容器，但**不跳标题容器**）
6. 链接：/bangumi/ → 番剧（PGC 兜底档）
   ↓ 都不中
   video（永不过滤）
```

角标排在链接前面，是因为 PGC 的番剧 / 电影 / 纪录片 / 国创 / 综艺 / 电视剧**共用同一个
`/bangumi/play/` 链接**，只有角标文字能区分。判定不出来的一律 `video` —— 宁可漏杀不可错杀。

两条曾经踩过的坑：

- **只看第一个 `<a href>` 是错的**。卡片里第一根链接常常是 UP 主空间
  （`//space.bilibili.com/...`）或统计入口，内容链接在后面。改成遍历前 8 个 anchor
  逐个判定 —— 这是 v1.0.0「勾了直播/番剧也不隐藏」的直接原因。
- **不能全文匹配关键词**。标题带「电影」两个字的普通投稿会被误杀，所以文字匹配一类
  限定在角标 class 上（可 `includes`），另一类限定成"叶子节点 + ≤4 字 + 精确相等"，
  并跳过 `[class*="tit"|"stats"|"up-"|"desc"]` 容器。

## v1.1.0：两个致命 bug（都是实测确认的，不是猜的）

用 headless Chrome 打开首页，同时抓 `feed/rcmd` 接口原始响应和 DOM，得到两条硬事实：

### 1. `is-rcmd` 不是广告特征，是所有推荐卡

```
72 个卡片节点：
  bili-video-card                           14  ← 骨架屏
  feed-card                                 10  ← 外层容器
  bili-video-card is-rcmd enable-no-interest 38  ← 真实卡片
  bili-video-card is-rcmd                    8  ← 真实卡片
  bili-live-card is-rcmd enable-no-interest  2  ← 真实卡片
```

`is-rcmd` = "is recommend"。v1.0.3 把它当成广告标记，于是勾上「过滤 · 广告」
等于**把整个推荐流清空**，而报告里仍然数得到卡片（它们只是被 `display:none` 了），
现象就是"卡片 22 张、全是 video，但一张都看不见"。

接口侧的证据：`goto` 只有 `av` 和 `ad` 两种，广告 item 的 `title` / `uri` / `bvid`
**全是空字符串**，渲染出来整张卡只有 `//cm.bilibili.com/...` 埋点链接。
所以广告只认链接，不认 class。

### 2. PGC 角标在 `stats` 里，被兜底扫描跳过了

PGC 的「番剧 / 综艺 / 纪录片」角标叠在封面左下角，和播放量 / 弹幕数共用
`.bili-video-card__stats` 容器。而 v1.0.x 的 `TEXT_SKIP` 里正好写着
`[class*="stats"]` —— 把唯一能区分 PGC 子类的文字整段跳过了。
直播能命中、PGC 全判成 `video`，原因就在这里。

现在 `TEXT_SKIP` 只跳 `up- / author / desc / date / info--bottom`：

- **不跳 stats**：角标就在里面；
- **不跳标题**：角标也可能挂在标题那一行；
- **跳作者**：UP 主叫「电影迷小雅」不会再把整张卡判成电影（已有回归用例）。

### 3. 隐藏/恢复改成自愈式

- 原 `display` 值存在元素自己的 `data-bhf-display` 属性上，不用 WeakMap
  （卡片被 Vue 复用后 WeakMap 记录会跟着旧节点丢，恢复时就找不到原值）；
- 原值是 `none` 时不还原成 `none`（那多半是 B 站 `v-show` 残留，还原会把卡片永久钉死）；
- **每轮 apply 都对账**：文档里带标记但本轮不该隐藏的节点一律恢复。卡片被复用、
  被移出扫描范围、选项刚关掉，都能自动回来；
- **容器展开**：如果某个"顶层卡片"里还套着 ≥2 张卡片，说明它是整块容器
  （一整列甚至整个推荐区），隐藏它会让整片流瞬间清空 —— 改成展开成最内层卡片逐个判定；
- 全部卡片都被隐藏时 `console.warn` 留痕。

## v1.2.0：番剧 / 综艺 / 纪录片 为什么必须走接口

抓了推荐接口原始响应，`goto` 只有四个合法值：

```js
ht = { av: 'av', ad: 'ad', ogv_season: 'ogv_season', live: 'live', login: 'login_card' }
```

也就是说**番剧、电影、纪录片、国创、电视剧、综艺在接口里是同一个 `goto: "ogv_season"`**，
卡片数据只有 `season_id / title / cover / plays / likes / dms / sub_title`，
**没有任何子类型字段**；链接也全是 `/bangumi/play/ss{season_id}`。

> 结论：靠 DOM 角标、class、关键词去分这六类，原理上就不可能稳定 ——
> 之前 v1.0.x 反复"综艺/课堂没命中"，根因在这里，不在选择器。

能给出准确答案的是它自己的 season 接口：

```
GET https://api.bilibili.com/pgc/view/web/season?season_id=47836   → result.type = 1
GET https://api.bilibili.com/pgc/view/web/season?ep_id=826497      → 同 season 的 type
```

| type | 含义   | type | 含义   |
| ---- | ------ | ---- | ------ |
| 1    | 番剧   | 5    | 电视剧 |
| 2    | 电影   | 7    | 综艺   |
| 3    | 纪录片 | 4    | 国创   |

实测（每类取真实 season 核对）：

```
season_type=1 sid=47836   鬼灭之刃         → type=1
season_type=2 sid=48001   剧场版咒术回战    → type=1  ← 归到番剧档，B 站自己就这么标
season_type=3 sid=104938  柯南幕后30年      → type=3
season_type=4 sid=28747   凡人修仙传        → type=4
season_type=5 sid=24053   非自然死亡        → type=5
season_type=7 sid=318350  最美的夜          → type=7
```

实现要点（`season.ts`）：

- 只对屏幕上出现的 `/bangumi/play/ss{id}` / `ep{id}` 卡片请求，按 id 去重 + `localStorage` 永久缓存；
- **只有勾了 PGC 六类中的任意一类才发请求**，否则一个都不发；
- 解析完成触发一次 `apply()`，自动纠正（未解析时先按「番剧」处理，所以会看到约 200ms 后才消失）；
- 连续 3 次请求失败（CORS 变更 / 风控）自动停用，退回纯 DOM 判定，不会每帧重试。

端到端验证（真实页面 + 真实 season_id，只勾「综艺 + 纪录片」）：

```
番剧-鬼灭     hidden=false   ← 保留
国创-凡人     hidden=false   ← 保留
纪录片-柯南   hidden=true    ← 隐藏
综艺-最美的夜 hidden=true    ← 隐藏
pgc: {resolved: 4, disabled: false, failures: 0}
```

## v1.2.1：行尾那张「带标签」的卡 = 广告位

B 站每行末尾通常插一张广告卡，封面左下角的标签就是**「广告」**两个字
（源码 `I("span", A$t, $(e.t("ad","广告")), 1)`，由 `info.isAd` 驱动）。
它是独立的「过滤 · 广告」开关，默认关闭 —— 只勾直播/番剧/综艺是不会有反应的。

判定只用两条硬特征，都不依赖 class：

```css
a[href*="cm.bilibili.com"]     /* 广告卡的落地/埋点链接，实测唯一稳定信号 */
封面 stats 区文字 === "广告"    /* CREATIVE_AD_TYPE 是火箭图标，没有文字，靠上一条 */
```

v1.2.1 把链接检查从"前 8 个 anchor"改成 `querySelector` 全量查找，
避免埋点链接排在后面时漏判。实测（真实首页）：36 张卡片、广告 2 张、
隐藏 2 张、页面残留含「广告」字样的可见卡 **0 张**。

## v1.3.0：楼层卡 `.floor-single-card` —— "每行末尾带角标那张"的真身

之前所有过滤失效的最后一块拼图：直播 / 番剧 / 综艺 / 电影 这类推荐位**不在**
`.feed-card` / `.bili-video-card` 里，而是独立的楼层卡：

```html
<div class="floor-card">
  <div class="floor-card-inner">
    <div class="floor-single-card">
      ← 真正的卡片，类名完全不同
      <a href="//www.bilibili.com/bangumi/play/ep2801753">…综艺 1995.0万 喜剧冷场？…</a>
    </div>
  </div>
</div>
```

它们从来不在扫描结果里，所以表现是：

- 报告里"卡片 48 张，video=48"，可页面上明明有「综艺」「电影」「国创」角标；
- 过滤怎么调都干净不了，因为那些卡**压根没参与判定**。

页面里实测的 floor 节点：`floor-card` ×7、`floor-card-inner` ×7、`floor-single-card` ×7、`floor-title` ×4。

现在 `CARD_SELECTOR` 补上 `.floor-single-card`，实测（只勾「综艺」）：

```
综艺 ep2801753   1995.0万 喜剧冷场？   hidden=true    ← 隐藏
国创 ep1508563   3505.0万 人总不可能   hidden=false   ← 保留
byType: video 67 / live 3 / ad 8 / bangumi 2 / guochuang 2 /
        variety 2 / cheese 1 / movie 1 / tv 1 / doc 1    共 88 张
```

另外加了"网格兄弟"兜底：和已知卡片**同一行、同宽（±10%）、同高（±30%）、
有图、内容链接 ≤4 个**的兄弟节点也当卡片，防止 B 站以后再换类名。
第一版判据太松，把轮播壳 `recommended-swipe-*` 也吞了，加上几何三条才收口。

### v1.3.1：补上「漫画」

楼层卡的角标结构是 `.floor-single-card .badge > .floor-title`，实测量到的 floor 类型有
九种：直播、番剧、国创、综艺、课堂、电影、电视剧、纪录片，以及**漫画**。

漫画卡链接固定指向 `manga.bilibili.com/detail/mc{id}`，所以判定直接看链接，
不依赖「漫画」这两个字：

```js
if (hrefs.some(href => href.includes('manga.bilibili.com'))) return 'manga'
```

实测（只勾「漫画」）：13 张楼层卡里只有漫画那张 `hidden=true`，其余全部保留。
自检用例补到 12 条，全部通过。

## v1.4.0：隐藏"占格子的那一层"，让网格真正重排

首页推荐是 `div.container.is-version8 { display: grid }`，每张卡外面还包了一层：

```html
<div class="container is-version8" style="display:grid">
  <div class="feed-card">
    ← 真正的网格子项
    <div class="bili-feed-card">
      ← 241×227 的包装，也占位
      <div class="bili-video-card">← 之前只隐藏这个</div>
    </div>
  </div>
</div>
```

只隐藏最里面的 `.bili-video-card` 时，外面两层仍然当着 241×227 的格子 ——
网格不会重排，原位就留下一个空洞（用户看到的就是"过滤掉了但空在那儿"）。

现在 `slotOf(card)` 会往上找"真正的格子"：

- 父节点是 `display:block` 之类的纯包装、且里面只有这一张卡 → 继续往上；
- 父节点是 `grid` / `flex` → 说明当前节点已经是网格子项，**停**；
- 父节点里有第二张卡 → 那是公共容器，**停**（绝不可能因为一张卡隐藏一整排）。

隐藏标记 `data-bhf-hidden` 和原 `display` 都记在这个格子上，所以：

- 恢复时能把格子的 `display` 精确还原；
- 对账（每轮 apply 扫一遍带标记的节点）也按格子做，不会漏；
- `state().hidden` 用 `slotOf(card).hasAttribute()` 判断，和 `marked` 数值一致。

实测（隐藏直播/综艺/电影/纪录片/电视剧/课程/漫画/广告）：

```
网格高度 4724px → 4216px
每行 5 张卡连续排列，无空洞
```

## 实现要点

- **卡片收集**：`.feed-card, .bili-video-card, .bili-live-card` 一起收，再按"最外层"去重 ——
  骨架屏阶段只有 `.bili-video-card`，加载完成后外面会套上 `.feed-card`。
- **判定缓存**：`WeakMap<Element, {sig, type}>`，`sig = 链接 + className`。
  B 站会复用卡片节点，内容变了指纹就变，自动重判；没变就直接取缓存，滚动时不重复解析 DOM。
- **隐藏手段**：`data-bhf-hidden` 属性 + `instantStyles` 的
  `[data-bhf-hidden]{display:none!important}` + **内联 `display:none!important`**。
  第三条是必须的：B 站卡片常自带 `display:...!important`，属性选择器会被压住。
  原值存进 `WeakMap`，取消勾选时精确还原。
- **触发时机**：`MutationObserver`（body childList subtree，rAF 节流）+ 首屏两次补扫
  （600ms / 1500ms，推荐接口比脚本执行晚）+ 设置变化监听。

## 勾了却没生效时：页面左下角会自己说话

只要出现「勾选了某类型但 0 命中」，页面左下角会浮出一条黑色提示：

```
首页推荐过滤 v1.4.0
已勾选「综艺」，但 36 张卡片里 0 命中
当前识别：video=24 / ad=12
点击复制诊断信息
```

点击就把完整诊断（类型计数 + 每张卡片的首个链接 / 角标文字 / 短文本及其 class）写进剪贴板。
正常情况下永远不出现，只有异常态才浮出来。

## 自检

```js
__bhf__.selftest()
```

用线上 CSS 里的真实类名（`.bili-video-card__info--icon-text`、`.feed-badge` + `.living-icon`、
`.is-rcmd`）拼出各类卡片，逐个走判定链路。全 `ok: true` 说明判定逻辑没问题，
问题只可能出在"跑的不是这份构建"或"卡片结构和线上不一致"。

## 调试

```js
__bhf__.version // 当前运行的版本号（"改了没生效"先看这个）
__bhf__.state() // {total, hidden, visible, byType, marked} —— 数量在但看不见时看它
__bhf__.reset() // 一键恢复所有被隐藏的卡片
__bhf__.pgc() // {resolved, disabled, failures} PGC 子类型解析状态
__bhf__.left() // 还看得见的卡片：`[类型] 角标 | 链接`，定位"过滤不干净"
__bhf__.grid() // 网格结构：祖先链 + 每个子节点 类名/尺寸/链接，看有没有卡片没被扫描到
__bhf__.report() // 一行式诊断，含类型计数 + 每张卡片依据，自动写剪贴板
__bhf__.scan() // {video: 28, live: 2, bangumi: 3, ...}  各类型卡片数量
__bhf__.inspect() // 前 6 张卡片的判定依据（cls / attr / badge / hrefs / exact / type）
__bhf__.apply() // 手动重跑
__bhf__.hidden() // 当前被隐藏的卡片元素
```

排查顺序：先 `version` 确认跑的是不是最新构建，再 `scan()` 看有没有扫到卡片（全 0 = 选择器没命中或被过滤的 DOM 不在预期位置），
再 `inspect()` 看单张卡片的 `badge` / `hrefs` 到底是什么 —— 能直接区分是角标没命中、
链接没命中，还是根本没扫到这张卡。
