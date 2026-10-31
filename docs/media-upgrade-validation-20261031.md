# 2026-10-31｜第二轮修复验收：后台媒体队列与文件发送权限

GitHub Actions 运行 **41167073846**：**success**，`npm run check` 通过，`node --test` **24/24 PASS，0 FAIL**。此结果是 GitHub Node 22 隔离测试，不是 Windows 上微信端真实验收。

## 本轮追加
- `src/services/outbound-file-policy.js` + `channel-file-service.js`：发送文件前执行绝对路径和真实路径校验，默认只允许 `stateDir/stickers/assets`、`stateDir/inbox`、`workspaceRoot/exports`、`out`、`generated`，拦截常见凭据文件名及符号链接越界。此保护不等于内容防泄漏扫描，需在正式环境检查隐私政策。
- `src/core/durable-inbound-queue.js` + `src/adapters/channel/weixin/index.js` + `src/core/app.js`：`getUpdates` 获取后**先在本地持久化原始微信更新，再保存 syncBuffer 游标**，后台顺序处理并在成功返回后确认消息；程序退出后可从本地继续处理；上限 500 项，满额拒绝推进游标。
- `src/adapters/channel/weixin/message-utils.js`：队列重试绕过易提前标记已读的内存去重，但保留持久队列的 replay 去重。
- `src/core/persistent-image-batch-store.js` + `app.js`：把等待合批的图片列表原子写本地，启动恢复，发给 Codex 被接受后才清理；图片在异步发送期间新到达会被保留。
- 新增队列恢复、重复入队、队列溢出、损坏数据拒绝、路径越界、凭据名和 symlink 拒绝、图片合批恢复测试。

## 重要限制（不得视为已上线）
- 尚未在用户 Windows 本机运行，**目前仅测试分支**；共享记忆和统一管理器仍在原版运行。
- 当前队列提供 **at-least-once** 恢复语义；如果远端 Codex 已收到请求、而本地确认前恰好崩溃，少数消息可能重复。没有承诺 exactly-once。
- 原始微信更新在本地 `stateDir/inbound-spool.json` 落盘直到确认，图片批次在 `stateDir/pending-image-batches.json` 落盘；含用户聊天内容，切勿放入 Git 仓库、日志或上传私有/公共记忆库。
- 某些异步内存缓冲（如等待 Codex 当前轮结束的普通文本）、真实系统权限行为、异常重试/多线程时序、文件内容分类防泄露、Crash 中断全流程仍需要额外实机验证。
- 在 Windows 本机部署前必须先对当前**独立启动器源码**备份、比较差异；复用统一管理器，不关闭共享 Codex 和记忆库；保留回滚。
- 仍欠缺真正的端到端微信测试：单图、多图、动图去重、连续发送、长时间网络断续、独立权限、重启后待处理消息验收。

---

# Cyberboss 媒体与表情包修复｜分支验收记录（2026-10-31）

依据用户18页《Cyberboss 完整升级、修复与验收任务书》开发。本文件记录**GitHub 分支源码**而非用户 Windows 运行状态。

## 本分支已改动

- `src/services/sticker-service.js`：单条 1–10 张各自验证和转换，失败不回滚已保存的其他图片；延续既有 SHA-256 去重；仅在批次结束后发送一条四项计数通知。
- `src/adapters/channel/weixin/media-receive.js`：单条消息附件默认最多 3 并发，结果按原顺序返回，独立失败；下载默认 15s 超时、瞬时网络/408/429/5xx 最多 3 次重试、500/1500/3000ms 回退和抖动；拒绝空文件及 HTML 响应。
- `src/core/app.js`：同一聊天的图片合批静默期默认 6000ms，`CYBERBOSS_IMAGE_BATCH_IDLE_MS` 可配。原有每批最多 10 张的拆分逻辑保持不变。
- `test/`：单条失败/去重/通知、并发及顺序、HTTP 重试和无效载荷、3张合并、12张拆分、图片说明文本的 9 项隔离测试。
- `.github/workflows/media-regression.yml`：Node 22 执行 JS 语法检查、`npm run check` 和隔离测试。

## 自动验收

2026-10-31 GitHub Actions 第2次回归运行 ID `41166142635` 最终 `success`：9项 `node:test` 全部通过，0项失败；当时已完成四个源码/测试文件的专门语法检查。之后新增的全库 `npm run check` 尚需最新 CI 运行结果确认。

## 未实现或需要 Windows 本机实测

- 真正把下载作业从微信 `getUpdates` 主轮询脱钩。现在单条消息虽然最多 3 并发，但处理当前微信 update 仍可能等待这一批媒体；不能声称彻底解决轮询堵塞。
- 严格的图片文件魔数、完整内容校验、原子写入、详细媒体阶段追踪、运行中崩溃后的持久队列与批量处理进程恢复。
- 专用 `CODEX_HOME` 的真实隔离、有效 `approval_policy` 和工具审批来源检查；禁止直接修改用户全局普通 Codex 审批配置。
- `cyberboss_channel_send_file` 任意文件发送路径的细粒度授权边界。目前不能把“已有工具”当作“已限制私人目录访问”。
- 本机 VPN/微信 CDN 路由、Crash restart、同实例断线恢复、微信图片/表情真实端到端，以及用户任务书中的全部16项测试。
- 不包含 Windows 本地状态、账号、Token、长记忆或表情资产。**本 PR 仍为 Draft，不应直接视为已部署。**

## 上线前的必要步骤

1. 在用户 Windows 本机查看统一管理器状态和**当前运行的 Cyberboss 源码位置**，对比远端 fork 和已安装启动器；任何不同不得盲目覆盖。
2. 备份当前源码、未提交变更、状态目录、登录、工作区/AGENTS、图片/表情库、自动同步；切勿把这些隐私文件提交到公共仓库。
3. 在隔离临时副本上应用已审查修复，运行 Node 测试和静态检查；验证微信文字不回退。
4. 实机完成图片1/3/6/12张、保存/去重/修改/删除表情、零审批、CDN异常、服务唯一实例等测试。
5. 审核后手动进入部署阶段，并留有回滚入口。不能以 Draft PR 替代系统层权限或用户 Windows 实机验收。

