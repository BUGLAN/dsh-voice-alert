# dsh-voice-alert

[![CI](https://github.com/BUGLAN/dsh-voice-alert/actions/workflows/ci.yml/badge.svg)](https://github.com/BUGLAN/dsh-voice-alert/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

[DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 插件：任务结束时播放提示音，
dsh 需要你回答或选择时播放另一种提示音，两者都可以额外弹出 Windows / macOS 系统通知，并在设置里
新增一个「语音提醒」页面统一配置。

[English →](README.md)

## 功能

| 提醒 | 触发时机 | 默认 |
|---|---|---|
| 任务结束提示音（`chime-up`） | 一轮对话停下并且保持停止，且不是被你取消的 | 开 |
| 需要你回复提示音（`ask-up`） | 会话出现待回答的问题或待授权 | 开 |
| 系统通知 | 上面两个时刻，弹 Windows / macOS 通知 | 关（需手动开启） |

两个时刻都来自客户端的会话状态快照（`uiSession.sessionStatus`），它合并了
`api-session/status` 事件与输入框上的待处理交互。若同一次更新里既有需要回复又有任务结束，只提醒
需要回复。

一轮对话结束并不等于任务完成，所以「任务结束」还要满足两个条件：

- **必须保持停止。** 会话空闲后再等 `completionDelayMs`（默认 1200 ms）才提醒。若在这段时间里
  又开始了新一轮 —— goal 轮次、自动续跑、工具循环继续 —— 会取消自己的提醒，因此中途的停顿不会
  被误报成任务完成。
- **不能是被取消的。** 持久化日志记录了这轮为什么结束（`turn/end` 带有结束原因）：`completed`、
  `blocked`、`max-tokens` 会提醒；`aborted`（用户、父 agent、hook 或销毁）、`interrupted`、
  `forked` 保持安静；`error` 按失败提醒，而不是按完成提醒。

### 什么时候不提醒

- 你按了停止 / 取消了这一轮（`aborted`，原因为 `user` 或 `parent`）；
- 这一轮由崩溃修复或 fork 标记收尾（`interrupted`、`forked`）；
- 这一轮属于内部运行：子 agent 或 teammate 会话（`origin: 'subagent'`，或任何带 `parentId` 的
  会话），它们的结束在日常工作中非常频繁；
- 在防抖时间内这一轮又继续了；
- 对应的开关是关的、总开关是关的，或者开着 `notifyBackgroundOnly` 而窗口就在最前面。

## 环境要求

- **DeepSeek Harness** —— 客户端需提供 `uiSession.sessionStatus` 与 `settings.section` 插槽
  （0.1.7 及以后）。
- **Node.js** 22.19+ 或 24+（dsh 进程加载 Host 部分）。
- **运行环境** —— 桌面端或网页端。提示音在页面里播放，因此页面至少需要一次用户操作；通知使用
  渲染进程的 `Notification` API，桌面端会把它转成系统通知中心的通知。

## 安装

DSH 的 profile 以 **bundle** 形式安装插件，本包就是一个 bundle：自带 `cordis.patch.yml` 并声明了
`dsh.bundle.patch`，所以 profile 只需要依赖它。

**通过 dsh 安装（推荐）。** 直接让 agent 安装这个 bundle，或自己调用插件管理工具：

```jsonc
{ "action": "install_bundle", "target": "github:BUGLAN/dsh-voice-alert" }
```

git 形式的地址会用 git 拉取，所以机器需要能访问 github.com。安装会把 `dsh-voice-alert` 加入该
profile 的 `dsh.profile.bundles`，把依赖写进 profile 的 `package.json`，并链接进 profile 的
`node_modules`。不需要构建：`lib/` 直接随仓库发布。

**手动安装。** 在 `~/.dsh/profiles/<profile>` 下执行：

```sh
pnpm add github:BUGLAN/dsh-voice-alert
```

然后把 `"dsh-voice-alert"` 加入该 profile `package.json` 的 `dsh.profile.bundles`，再启动 dsh。

### 更新、停用、卸载

```jsonc
// 只停用，不卸载
{ "action": "set_plugin", "target": "include:voice-alert", "enabled": false }
// 卸载
{ "action": "remove_bundle", "target": "dsh-voice-alert" }
```

更新：在 profile 目录里执行 `pnpm update dsh-voice-alert`。`github:` 形式的依赖跟随默认分支，
pnpm 会把实际拉取到的 commit 固定下来，所以要用 update 才能拿到更新的提交。

## 设置页面

设置 → **语音提醒**（order 60，排在 Agent presets 之后）：

- 提示音总开关和音量滑块；
- 每个声音一个分组 —— 任务结束、需要你回复 —— 各自带独立开关；
- 内置音色选择（8 种；选中即保存并试听）以及 **试听** 按钮；
- 可选的自定义音频（≤ 1.5 MB），以 data URL 保存，**清除** 可回到内置音色；
- **系统通知** 分组：自己的开关、每个事件一个开关、「仅当窗口不在最前时通知」开关、每个事件可
  覆盖通知正文、当前权限状态，以及 **发送测试通知** 按钮（申请权限并真的弹一条通知，方便你看
  效果和摆放位置）。

当本插件已经为同一个事件播放过提示音时，系统通知会静音，所以不会听到两声；插件提示音关掉时，
通知保留系统提示音。

### 通知正文写什么

正文说的是「哪件事」，而不是「哪个会话」：取该会话里**你自己发出的最新一条 prompt**，压成一行并
限制在 120 字以内。所以完成通知读起来是你要的那件事，而不是会话自动生成的标题。user 角色的消息
不一定是 prompt —— 注入的上下文（工作区说明、技能目录、teammate 框架文本）也是 user 角色 ——
因此只认 `source.kind === 'user'`。

每个提醒的正文优先级：你显式填写的覆盖文本 →（失败的那一轮）失败信息 → 最新 prompt → 会话标题 →
内置文案。

## 配置项

每个偏好都是本插件 entry 的 Config 字段，因此既能在设置页面里改，也能写在 profile 的
`cordis.yml` / `cordis.patch.yml`（或 Plugins 页面的配置编辑器）里：

| 键 | 类型与默认值 | 含义 |
|---|---|---|
| `enabled` | boolean，`true` | 两个提示音的总开关 |
| `volume` | number 0–1，`0.6` | 音量（满量程的比例） |
| `completionEnabled` | boolean，`true` | 任务结束时播放提示音 |
| `completionTone` | string，`chime-up` | 未设置自定义音频时使用的内置音色 |
| `completionFile` | string，`''` | 自定义完成提示音，data URL |
| `completionDelayMs` | number 0–60000，`1200` | 完成提醒的防抖时长；`0` 关闭防抖 |
| `waitingEnabled` | boolean，`true` | 需要你回复时播放提示音 |
| `waitingTone` | string，`ask-up` | 未设置自定义音频时使用的内置音色 |
| `waitingFile` | string，`''` | 自定义回复提示音，data URL |
| `notifyEnabled` | boolean，`false` | 在提示音之外再弹系统通知 |
| `notifyCompletion` | boolean，`true` | 任务完成时通知 |
| `notifyWaiting` | boolean，`true` | 需要你回复时通知 |
| `notifyBackgroundOnly` | boolean，`true` | 仅当窗口不在最前时通知 |
| `notifyCompletionBody` | string，`''` | 完成通知正文；留空用内置文案 |
| `notifyWaitingBody` | string，`''` | 回复通知正文；留空用内置文案 |

8 种内置音色：`chime-up`（清脆上行）、`chime-down`（柔和下行）、`bell`（铃音）、`ping`（单声
提示）、`double`（双声提示）、`triple`（三连音）、`ask-up`（轻快上行）、`ask-down`（轻快下行）。
`completionFile` 与 `waitingFile` 由设置页面的文件选择器写入；手写就要粘贴完整的 data URL。

### 配置从哪一层来

偏好按层读取，后面的覆盖前面的：

1. 浏览器部分里的内置默认值；
2. 本 entry 的 Config，以 `window.__DSH_VOICE_ALERT__` 注入页面 —— 所以
   `cordis.patch.yml` 的值或 Plugins 页面的配置编辑器会生效；
3. 浏览器的 `localStorage` 镜像，也就是设置页面写入的值；
4. profile 组合了设置提供者时，持久化的 Host 设置命名空间 `voice-alert`。

没有设置提供者的 profile 也能用：第 4 层不生效，设置页面的写入只存在于浏览器本地（跨刷新和重启
有效，按浏览器区分），页面会提示这一点。以后加入设置提供者无需改动本插件 —— Host 部分已经注册了
该命名空间，届时设置作用域会自动优先于镜像。

## 开发

```sh
npm install
npm test        # node tests/smoke.mjs && node tests/host.mjs
```

`tests/smoke.mjs` 在桩化的浏览器全局对象与桩化的 Cordis 上下文里运行 `lib/client.js`，然后驱动
会话状态 observable：设置分组注册成功、控件能写入、两个提示音都会响、不该响的情况保持安静。
`tests/host.mjs` 在桩化的 Host 上下文里运行 `lib/index.js`：命名空间注册成功、entry Config 能
到达页面。不需要浏览器、不需要密钥、不需要构建；CI 会在 Linux、Windows、macOS 上分别跑一遍。

### 目录结构

```
package.json         包名、./client 导出、dsh.client + dsh.bundle.patch
cordis.patch.yml     bundle 层：插入名为 dsh-voice-alert 的 `voice-alert` 行
lib/index.js         Host 部分：设置命名空间 + 把 Config 注入页面
lib/client.js        浏览器部分：loader bundle —— 声音、设置分组、触发逻辑
tests/smoke.mjs      浏览器部分的无密钥测试
tests/host.mjs       Host 部分的无密钥测试
```

浏览器部分直接按客户端模块系统所提供的 bundle 格式编写
（`window.__ModuleLoader__.load({ id, factory })`），并且只请求模块表里的基础模块（`react`、
`@deepseek-ai/dsh-client-store`），所以本包不需要构建步骤。

`inject` 特意只声明了 `['slots', 'locale']`。其余服务都通过 `ctx.get(...)` 读取：没拿到可选服务的
插件仍保持 active、只是功能降级；而把它声明成依赖，一旦这套组合里没有该服务，整个插件 —— 包括设置
页面 —— 就会一直处于 pending。

**改完代码之后：** `lib/client.js` —— 把该行关掉再打开（`set_plugin` 两次），重新扫描会给产物一个新
版本，浏览器会重新拉取；`lib/index.js` —— Host 模块留在 Node 的模块缓存里，所以要下次启动 dsh
才生效。

## 说明与限制

- Host 部分 import 了 `@deepseek-ai/schemastery`，这是本包唯一的依赖。如果 profile 是以路径
  link 本目录（而不是拉取）的方式安装，就需要该模块在这里可解析。
- 提示音在浏览器页面里播放，所以页面至少要收到过一次用户操作（浏览器的自动播放规则）。在用户操作
  之前创建的 `AudioContext` 会在下一次操作时被恢复。
- 通知权限：DeepSeek Harness 桌面端会为自有窗口授予非媒体权限，所以在桌面端这个开关不需要弹窗。
  在普通浏览器里，第一次开启或点测试按钮会触发浏览器授权弹窗，被拒绝时页面会显示提示。
- 默认只在窗口不在最前时弹通知，免得打断正在看屏幕的你。
- 该 profile 下每个打开的页面都会提醒；触发是按 profile 的，不是按窗口的。
- 自定义音频整个存在设置值里，请控制在通知长度的片段内；过大的文件会被拒绝并给出提示。
- 内置音色是 Web Audio 振荡器生成的，不会从网络拉取任何东西。
- 完成提醒的防抖是 Config 字段（`completionDelayMs`，默认 1200 ms，`0` 关闭）。它不在设置页面上
  渲染；如果某个工作流每轮之间的停顿经常超过一秒，就在 profile 的 `cordis.patch.yml` 里设置它。

## 许可证

[MIT](LICENSE)
