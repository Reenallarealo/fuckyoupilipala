# fuckyoupilipala

个人用 B 站界面重设计脚本（Firefox + Violentmonkey），当前版本 **1.1.3**。

## 行为一览

| 页面 | 效果 |
|------|------|
| **首页** `www.bilibili.com/` | 首屏居中搜索（屏蔽历史/热搜）；下滑后搜索栏吸顶并垂直居中；下方为关注动态视频列表 |
| **搜索页** `search.bilibili.com/*` | 隐藏站点顶栏 / 页脚证书 / 吸顶搜索条；保留页面内主搜索与结果 |
| **视频页** `/video/...` | 原版结构 + 宽屏贴顶 + 暗色；弹幕输入并入播放器底栏；隐藏部分杂讯控件 |
| **匿名模式** | Violentmonkey 菜单开关；开启后拦截观看心跳/历史上报等，尽量不改账号推荐画像 |

当前脚本版本以 [`bilibiliX.user.js`](./bilibiliX.user.js) 头部 `@version` 为准。

## 安装（Firefox）

1. 安装 [Violentmonkey](https://addons.mozilla.org/firefox/addon/violentmonkey/)
2. 打开 Violentmonkey → **+** → **从文件安装**，选择本仓库的 [`bilibiliX.user.js`](./bilibiliX.user.js)  
   或：新建脚本，把文件内容全部粘贴进去保存
3. 打开/刷新对应页面；若新增了 `@match` 域名，按提示授权

开发时改完脚本后，在 Violentmonkey 里全文覆盖保存，再硬刷新（Ctrl+F5）。

## 匿名模式（阻断训练）

Violentmonkey 图标 → 本脚本 → **「切换匿名模式（阻断观看上报）」**。开启后标题前缀 `[匿名]`，并写入本地开关（刷新仍保持）。

**会拦（假成功、不发真实请求）**

- `/x/click-interface/web/heartbeat`（及 `/x/click-interface/heartbeat`）
- `/x/v2/history/report`、`/x/v1/medialist/history`
- 直播进房/点赞上报：`roomEntryAction`、`likeReportV3`
- 推荐负反馈：`/x/feed/dislike`（含 cancel）等

**不拦（页面必需）**

- 稿件信息 `view`、评论 `reply`、取流 `playurl`、分 P `pagelist` 等

**副作用与残留信号**

- 服务端历史通常不再增长，续播进度会失效
- 点赞 / 投币 / 收藏 / 关注 **仍会生效**，也仍可能影响推荐
- 无法保证挡住 B 站全部新埋点；手机 App 不受本脚本影响

### 自测清单

1. 开启匿名 → 打开任意视频 → DevTools Network：`heartbeat` / `history/report` 不应出现真实成功写库（或由脚本短路为本地假响应）
2. 播放、清晰度、弹幕、评论加载正常
3. 打开 [历史记录](https://www.bilibili.com/history)：刚看的稿件不应新增（或明显不更新）
4. 关闭匿名再看一条：心跳恢复，历史可再写入
5. 匿名开启下点赞仍可成功（属预期残留信号）

## 说明与限制

- **自动播放**：会点击播放并尽量保持有声；浏览器若拦截带声音的自动播放，会保持暂停而不是改成静音开播，点一下播放即可。
- **B 站改版**：依赖页面 DOM / Shadow DOM，官方大改后可能需要更新选择器。
- **关注动态**：需已登录；接口失败时列表区会提示原因。
- **不修改服务端**：仅前端 CSS / 有限 DOM 调整与请求短路。
- **首屏闪一下原版**：1.0.3 起在 `document-start` 立刻盖暗色遮罩并注入关键隐藏；若仍偶发，多半是扩展注入晚于浏览器首次绘制，硬刷新后再看。

## 文件

- `bilibiliX.user.js` — 可直接安装的用户脚本
- `Bilibili-Evolved-master/` — 可选本地参考（非运行依赖）
- `宽屏参考脚本.js` — 宽屏思路参考
