# 子代理模型解析：完整链路报告

日期：2026-11-13
范围：Cursor 3.30.8 / Windows x64 / 扩展 0.9.13 / 补丁 revision 32

## 1. 结论摘要

- 子代理的模型来自**子会话自己的 modelConfig**，Cursor 不会自动继承父对话。
- 我们已有的改写函数 `resolveRequestedModel` 用真实数据回放时**结果正确**（返回 `deepseek-v4.1-flash` + 所属服务凭据）。
- 但它依赖两个运行时全局（目录、凭据快照），这两个值只在扩展激活时由 `Settings.apply()` 写入。
- 21:06/21:08 的子代理失败，发生在 `job.json` 被写入 BOM、扩展激活中断的窗口内：`apply()` 没执行 → 全局缺失 → 改写函数返回 undefined → 子代理退回 `default` → 命中 Cursor 额度。
- BOM 问题已在 0.9.13 修复（读取时剥离 BOM，并重写了该文件）。**尚无 0.9.13 之后的一次真实子代理运行证据**，这是唯一未闭环项。

## 2. 链路（自上游到下游）

### 2.1 父对话发起 Task
- SDK：`Task` 工具 → `executeSubagent` 代理 → `subagent proxy: delegating to renderer`（日志可证）。
- 渲染层：创建子会话 composer，`subagentInfo.parentComposerId` 指向父会话；`modelConfig.modelName` 初始为 `default`。

### 2.2 子会话构建请求
`buildRequestedModel`（渲染层）：

```js
const d = selectedModels[0]?.modelId ?? composerModelName ?? modelDetails.modelName ?? "";
```

子会话的 `selectedModels[0].modelId` 是 `default`，所以 `d = "default"`。

### 2.3 我们的改写（唯一注入点）
`resolveRequestedModel(id, composer, parentModelName, buildCredentials)`：

1. 若目录或凭据全局缺失 → 返回 undefined（不改写）。
2. 若非子会话 → 返回 undefined（主对话保持原生身份）。
3. 按内部名/裸名查目录；若仍是 `default` 且有父会话 → 取父会话模型。
4. 返回 `{ modelId: 供应商模型名, credentials: buildCredentials(凭据) }`。

命中后 `requestedModel` 会带 `apiKeyCredentials`，后续宿主/本地运行时用该地址与密钥。

### 2.4 为什么 21:06 那次没走到第 3 步
- `job.json` 被 PowerShell 写入 BOM（`EF BB BF`），`JSON.parse` 抛 `Unexpected token '\ufeff'`。
- 该异常发生在扩展激活链上，`Settings.apply()` 未执行。
- 于是 `globalThis.__cursorNativeApiCatalog/__cursorNativeApiCredentials` 均为 undefined。
- 改写函数按设计返回 undefined → 请求保持 `default` → Cursor 后端 → 额度错误。

### 2.5 真实数据回放（离线，使用库里真实会话）
输入：子会话 `d4acb71f-…-49b16797ceb6`（`modelConfig=default`，`subagentInfo.parentComposerId=199272e6…`），父会话模型 `cursor-native-api:e3d28f39…:deepseek-v4.1-flash`，目录含 14 个模型。

输出：

```json
{ "modelId": "deepseek-v4.1-flash", "credentials": { "case": "apiKeyCredentials", "apiKey": "offline" } }
```

说明改写逻辑本身正确，问题在运行时前置条件。

## 3. 已修复的问题清单（按发生顺序）

| 时间 | 症状 | 根因 | 处置 |
|---|---|---|---|
| 14:44 | 安装任务失败 | `Wait-Process -Timeout 86400` 超过 32767 | 移除该参数，保留 Node 侧超时 |
| 19:02 | `reading 'version'` | `packageJson` 拼写 | 改 `packageJSON` |
| 19:02 | `cannot decode … apiKeyCredentials` | 用 JSON 解码 `aiserver.v1.ModelDetails` | 改调原生 `uEp` 构造凭据 |
| 20:06 | 主对话连接失败 | 改写规则误伤主对话 + Agent Host 分流 | 规则限定子代理；关闭 Agent Host 分流（revision 31） |
| 21:00 | `reading 'e3d28f39…'` | 快照未写入时读取凭据 | 快照缺失返回 undefined；composer 路径恢复命令取值 |
| 21:2x | `Unexpected token '\ufeff'` | PowerShell 写 job.json 带 BOM | 读取剥离 BOM，文件重写无 BOM |

## 4. 验证矩阵

| 项 | 方式 | 结果 |
|---|---|---|
| 改写函数正确性 | 真实父子会话回放 | ✅ 返回正确模型与凭据 |
| 主对话恢复 | 真实日志：gateway 请求 ok，runtime=legacy | ✅ 3 条 ok（21:06:13/25/43） |
| 子代理（0.9.13 之后） | 尚未运行 | ⏳ 待验证 |

## 5. 待验证项的判定标准

装 0.9.13、Reload Window 后跑一次子代理，然后检查：

1. 子会话 composerData 的 `modelConfig.modelName` 不再是 `default`；
2. `agent-exec` 日志出现 `Gateway request settled` 且 `modelId=deepseek-v4.1-flash`，时间在子代理启动之后；
3. 不再出现 `You've hit your usage limit`。

三条同时成立才算修好。任一条不成立，按第 2 节链路逐跳定位，不再改请求层。

## 6. 已知限制

- 该改写依赖扩展激活成功；激活失败会导致子代理静默退回 `default`（主对话不受影响）。
- 若 Cursor 再次强制启用 Agent Host（`agent_host_local_loop`），需要把同样的模型/凭据注入搬到宿主侧，即“下一版的第 2 条”。
