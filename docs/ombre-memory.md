# OB 共享记忆 B 接入

本分支配合 Ombre Brain 的 `testing/ob-shared-memory-b` 开发分支。默认不启用，不影响现有微信使用。

必需环境变量：

- `CYBERBOSS_OB_URL`：OB 根地址，公网必须 HTTPS；本机允许 localhost HTTP。不带 `/mcp` 或 `/api`，不含查询参数、账号密码或密钥。
- `CYBERBOSS_OB_TOKEN`：与 OB 的 `OMBRE_SHARED_CHAT_TOKEN` 一致，至少 32 字符。
- `CYBERBOSS_OB_WORKSPACE_ROOT`：唯一允许共享的现有伴侣工作区绝对路径。
- `CYBERBOSS_OB_TIMEOUT_MS`：可选，默认 3000 毫秒。
- `CYBERBOSS_OB_MCP_TOKEN`：仅在另行配置 Codex 的 OB MCP 时使用，对应 `OMBRE_MCP_TOKEN`，与桥接 Token 分开。

数据路径：`CYBERBOSS_STATE_DIR/ombre-outbox`。每条先原子写盘，再由后台补传；确认回执后删除待传正文、保留不含原话的 .sent 去重回执。永久性拒绝保存为 .blocked，等待人工处理。队列上限 10000 条，超过上限或写盘失败会在 `doctor` 和 `/status` 中报告；不要忽视该状态。

本轮仅共享文字原话，不上传附件、系统提示词或工具结果。助手档案来自成功送达的微信气泡，不等于完整模型隐藏上下文。每轮检索失败仍正常聊天。普通 GPT 窗口须调用 `chat_append` 才能把其对话保存进共享档案；安装插件本身不会自动上传全部聊天。

启动流程沿用已有 `npm run shared:start`。`npm run doctor` 或微信 `/status` 查看状态。只配置桥接可以自动读取长期记忆；若希望微信模型主动 `hold/grow`，仍需另将原有 OB `/mcp` 接入对应 Codex／Claude Code 运行时。

完整数据边界、接口、鉴权、备份和双向验收步骤见配套 OB 仓库 `docs/SHARED_CHAT.md`。
