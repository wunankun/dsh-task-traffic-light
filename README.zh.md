# DSH 任务红绿灯

给 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 用的 macOS 悬浮红绿灯。贴在屏幕边上，不用切窗口就知道几个 agent 在干嘛、哪个在等你。

<img src="docs/demo.gif" width="452" alt="会话在跑时亮红灯，有东西等你时亮黄灯；绿灯一直亮到你打开那个会话。">

[English](README.md) · [MIT](LICENSE)

## 三盏灯，三件事

| 灯 | 什么时候亮 | 点一下 |
|---|---|---|
| 🔴 红灯 | 至少有一个顶层会话在跑 | ——（只是显示） |
| 🟡 黄灯 | 有会话在等你批准或回答 | 把 DSH 带到最前，切到**第一个**在等的会话 |
| 🟢 绿灯 | 有会话跑完了，DSH 里那颗未读绿点还没消 | 把 DSH 带到最前，切到**最早完成**的那个 |

三盏灯互相独立，红灯和绿灯可以同时亮。

## 安装

**第一步，装插件**（在 DSH 里）：

```sh
dsh plugin add dsh-task-traffic-light
```

也可以在 DSH 的插件市场里点安装。装完刷新一次页面。

**第二步，装小应用**：

```sh
curl -fsSL https://raw.githubusercontent.com/wunankun/dsh-task-traffic-light/main/scripts/install-app.sh | sh
```

脚本会把 `TaskTrafficLight.app` 放进 `/Applications` 并打开。想手动也行：[Releases](https://github.com/wunankun/dsh-task-traffic-light/releases/latest) 下载 `TaskTrafficLight.zip`，解压拖进"应用程序"，第一次右键 → 打开（ad-hoc 签名，没有公证）。

**第三步**：重启 DSH、刷新页面，把灯拖到你顺眼的位置。位置会记住。

## 绿灯为什么跟着 DSH 走

DSH 本来就会给"跑完了、但你当时没在看"的会话，在列表里标一颗绿点。红绿灯的绿灯就是这颗点的镜子：

- 只要还有会话带着绿点，灯就亮着；
- 你打开那个会话（点灯或者自己点都行），绿点一消，灯一秒内跟着灭；
- 最后一点消完，绿灯才灭。

有好几个没看的时候，每点一次切到最早完成、把它消掉，所以连点两下就是在排队处理。

## 它是怎么工作的

```
DSH Host 插件 ──写──> ~/.dsh/task-traffic-light/state.json <──读── TaskTrafficLight.app
        ▲                                                                 │
        └────── /api/task-light/focus（带认证、同源）◀── focus.json ────────┘
```

- 插件写一份快照：在跑数量、待处理交互、等待中的会话 id、未读完成的会话 id、实时速度。
- 小应用轮询这个文件画灯。
- 点击时写 `focus.json`，插件先确认目标会话确实还亮着那盏灯，再通过 DSH 自己的本机认证通道交给前端；页面切过去后回执。
- 子代理会话被过滤掉：它们在列表里没有行，永远点不掉，所以不能把灯卡住。

## 隐私

不开端口、不联网、不执行任何命令。插件只在 `~/.dsh/task-traffic-light/` 下写一个 JSON，小应用在你点灯时再写一个。全部代码大约 600 行 JavaScript + 500 行 Swift，抽空能通读一遍。

## 环境要求

- macOS 13 或更新，Apple 芯片或 Intel（发布包是 universal）
- DeepSeek Harness 0.2.1 或更新，且能往 profile 里加插件

## 出问题怎么办

**三盏灯全黑。** 10 秒内没更新过 `state.json` 就按"DSH 没在跑"处理。确认插件启用了（`dsh plugin list`），再 `tail -f ~/.dsh/task-traffic-light/state.json` 看看有没有在刷新。

**点了没反应。** 点击是由 DSH 页面执行的，所以页面必须加载到插件的客户端那一半——装完刷新一次页面。超过 30 秒的点击会静默过期。

**灯亮着但看着没事。** 插件只统计顶层会话，子代理不会单独点亮任何灯。

## 自己编译

```sh
git clone https://github.com/wunankun/dsh-task-traffic-light
cd dsh-task-traffic-light
./macos/build.sh          # 编 universal，需要 Xcode 命令行工具
open macos/TaskTrafficLight.app
```

## 许可证

MIT © 2026 wunankun
