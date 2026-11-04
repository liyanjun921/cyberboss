# Live2D 身体接入｜CyberBoss V1（实验版）

> **状态：独立适配模块，未部署到用户机器或腾讯云。** 源项目：[zziying/ai-live2d-body-starter](https://github.com/zziying/ai-live2d-body-starter)。此目录不复制 Live2D SDK、模型或原仓库源码。

## V1 已实现与边界

- **输入**：Live2D starter 的三类触摸（stroke/double/dizzy）→ 白名单验证 → CyberBoss 原生 `SystemMessageService.queueMessage()` → 绑定的 CyberBoss 会话。
- **输出**：本机 CLI 通过 starter 的 `127.0.0.1:3470` 身体 API 发出受限的表情、动作、气泡、TTS 指令。
- **测试**：`node --test test/live2d-body.test.js`。测试不调用 AI，不需要真实模型。
- **不声称**：没有自动安装桌宠、没有连接 ChatGPT 官方 Chat/Work 的内部会话、没有接入 OB、没有完成跨机器云端推送、没有制作专属人物模型。
- **安全**：输入必须精确匹配三种事件；不接受用户文本变成命令。调用本地身体 API 强制读取 `.pet-token`，不开放端口到公网。外部事件只是触摸事实，不是指令。复用 CyberBoss 现有发送者和工作区的安全解析，不能凭空猜绑定。

## 1. 先运行原版透明桌宠（Windows）

准备 Node.js 22+、Git、pnpm 和你有权使用的 **未加密 Cubism 3+** 模型。模型目录应含 `.model3.json`、`.moc3`、贴图。先用 Live2D 官方免费的示例模型验证更稳妥；请遵守官方及模型作者条款。

在 PowerShell：

```powershell
git clone https://github.com/zziying/ai-live2d-body-starter.git
cd ai-live2d-body-starter
npm install -g pnpm
pnpm install
```

把模型文件夹放进 `src/renderer/public/model/`，设置原项目根目录 `pet.config.json` 中的 `model.path`（比如 `model/hiyori/hiyori.model3.json`，实际以你的模型文件名为准）。第一次先保持 `inject.mode="none"`，不接大脑，只检验画面、鼠标和动作。

```powershell
pnpm dev
```

原 README 当前明确说明 **`pnpm dev` 可用，打包/preview 有已知模型加载问题**；V1 不承诺可发行 exe。

## 2. 从自己的 CyberBoss 分支获取此模块

使用本分支 `feat/live2d-body-v1-20261105` 中的 `integrations/live2d-body/` 与 `test/live2d-body.test.js`。不要把这个实验分支合并到生产 main，更不要覆盖正在运行的 CyberBoss 目录。

在对应 CyberBoss 检出内运行：

```powershell
npm ci
node --test .\test\live2d-body.test.js
```

## 3. 先验证桌宠的身体 API

打开另一个 PowerShell 窗口，把下面路径改成**你实际克隆的 starter 目录**：

```powershell
$env:LIVE2D_PET_ROOT = "C:\你的目录\ai-live2d-body-starter"
node .\integrations\live2d-body\pet-cli.js status
node .\integrations\live2d-body\pet-cli.js emotion happy
node .\integrations\live2d-body\pet-cli.js action nod
node .\integrations\live2d-body\pet-cli.js bubble "摸摸我呀"
```

这些命令要从 CyberBoss 仓库根目录运行。若启用原版 TTS 才能运行 `pet-cli.js say "你好"`。模型是否真的产生相应脸红或动作，由该模型的参数和配置决定。

脚本自动读 `$env:LIVE2D_PET_ROOT\.pet-token` 并按原版的 `X-Pet-Token` 鉴权调用本机 API。不要把 token 写进 Git、聊天记录或者任何公开前端。

## 4. 本机 CyberBoss 与桌宠连通后再打开触摸注入

**重要：本节只适用于 CyberBoss 本体及已绑定的会话状态可在同一台 Windows 电脑访问的情况。** 如果 CyberBoss 正运行在腾讯云，此调用不会神奇地连接到云端的那个会话。云端模式需要另做带身份验证的跨设备事件桥，并验证真实派发。

在 starter 的 `pet.config.json` 中替换 `inject` 部分（把绝对路径改成你的真实目录；JSON 里推荐使用 `/`）：

```json
{
  "inject": {
    "mode": "command",
    "tmuxTarget": "claude:0.0",
    "command": [
      "node",
      "C:/你的目录/cyberboss/integrations/live2d-body/inject-touch.js",
      "{message}"
    ],
    "messages": {
      "stroke": "[pet-touch] 你被摸摸了！",
      "double": "[pet-touch] 你被戳了一下！",
      "dizzy": "[pet-touch] 你被晃晕了！"
    }
  }
}
```

这是 `inject` 字段的示意，**不要用整段 JSON 覆盖已有 pet.config.json**，保留 model、window、tts 等其他字段。

注入器默认使用现有 CyberBoss 配置、状态文件、账号绑定，并借用仓库已存在的 Garden 安全解析器。自定义 CyberBoss 位置时，在启动 starter 的**同一个** PowerShell 窗口设定（不要提交到 Git）：

```powershell
$env:LIVE2D_CYBERBOSS_HOME = "C:\你的目录\cyberboss"
$env:LIVE2D_CYBERBOSS_STATE_DIR = "C:\Users\lee\.cyberboss-xlc"
# 多用户或多工作区时，按实际已绑定的目标提供：
# $env:LIVE2D_CYBERBOSS_SENDER_ID = "真实发送者ID"
# $env:LIVE2D_CYBERBOSS_WORKSPACE_ROOT = "C:\真实工作区"
```

重启 `pnpm dev` 后，双击/抚摸桌宠会发一个白名单事件。返回 `{"queued":true}` 只表示进入 CyberBoss 持久队列，**不等于 AI 已经醒来或回复**。只有运行中的 CyberBoss 真正派发后才算完成端到端验收。未绑定唯一用户或工作区时它会拒绝注入，而不是乱投递。

## 5. 接下来该做什么

1. 确认 starter 原生 Windows 渲染、模型适配和 `pnpm dev` 启动（L1）。
2. 在**与 CyberBoss 同机**的测试配置验证触摸入队、派发、AI 响应（L3 输入）。
3. 当前 CyberBoss 云端常驻时，新建鉴权跨机器事件桥；不要把 `3470` 或 `.pet-token` 暴露到公网。云端有权事件经 bridge 投递到本地 agent，由本地 controller 调原 starter API（L2/L3 输出）。
4. 将触摸事件与 Desire 自主唤醒区分：触摸是传感器输入，醒来/是否回应由 AI Runtime 决策，不应每次强制打断。
5. iOS/PWA 版需要另外做 Web Live2D 渲染器与云端消息订阅；Electron 透明窗不能直接运行在 iPhone 上。

**原创代码授权**：本新增适配模块属于 CyberBoss 仓库代码，按该仓库的 AGPL-3.0-only 条款处理。Live2D 运行库、模型遵其各自授权。
