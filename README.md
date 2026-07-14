# BilibiliX

个人用 B 站界面重设计脚本（Firefox + Violentmonkey）。

## 第一版行为

| 页面 | 效果 |
|------|------|
| **首页** `www.bilibili.com/` | 首屏只保留居中搜索栏（屏蔽历史/热搜/相关搜索）；向下滑动显示**关注动态视频流**（非首页推荐） |
| **搜索页** | 不改动 |
| **视频页** `/video/...` | 进入后整屏播放器并尽量自动播放；向下滑动后左侧为详情+评论，右侧为相关推荐 |

## 安装（Firefox）

1. 安装 [Violentmonkey](https://addons.mozilla.org/firefox/addon/violentmonkey/)
2. 打开 Violentmonkey → **+** → **从文件安装**，选择本仓库的 [`bilibiliX.user.js`](./bilibiliX.user.js)  
   或：新建脚本，把文件内容全部粘贴进去保存
3. 打开/刷新 [bilibili.com](https://www.bilibili.com/)

开发时改完脚本后，在 Violentmonkey 里重新保存/更新，再硬刷新页面（Ctrl+F5）。

## 说明与限制

- **自动播放**：浏览器可能拦截带声音的自动播放；脚本会先尝试正常播放，失败则尝试静音播放，并点击播放按钮。若仍被拦，点一下页面即可继续。
- **B 站改版**：依赖页面 DOM 结构，官方大改版后可能需要更新选择器。
- **只改首页与视频页**：搜索、动态、空间等保持原样。
- **不修改服务端**：仅前端 CSS/DOM 重组。

## 文件

- `bilibiliX.user.js` — 可直接安装的用户脚本
