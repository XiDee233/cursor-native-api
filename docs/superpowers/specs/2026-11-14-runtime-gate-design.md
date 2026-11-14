# 第三方模型本地运行时接入设计

## 目标

让 Cursor 原生聊天中的第三方模型走本地运行路径，同时保持官方 Agent Host、官方模型和官方工具链不变。

## 源码事实

1. `cursor-local-agent-runtime` 已被扫描，builtin cache 中 `isValid: true`。
2. 它的 `dist/main.js` 导出 `activate`，并在激活时调用
   `vscode.cursor.registerLocalAgentRuntimeProvider(provider)`。
3. 普通构建中它不会被放入 Extension Host，因为放置过滤器是：

   ```js
   function k6f(e) {
     return mo.localMode && e?.get("cursor/useDedicatedLocalAgentRuntimeHost", -1) === "true";
   }
   ```

   `mo.localMode` 在普通 Cursor 构建中固定为 `false`。
4. 同一个过滤器还出现在 `NZa` 的扩展排除条件中。
5. `AgentExecProviderService.runLocalAgentInDedicatedExtensionHost()` 没有
   `localMode` 门槛，只等待 `_localAgentRuntimeHandler`。
6. 专用运行时收到请求后创建 `LocalAgentClient`，使用请求里的
   `baseUrl`、`apiKey`、`availableModelIds` 和 `providerModelCatalog`。
7. 工具通过 `callbacks.executeExec` RPC 回到 renderer 的
   `_localAgentControlledExecManagers`，由 composer 的 `resourceAccessor`
   执行。
8. Host 的 `managed-local` 路径不是第三方 OpenAI 客户端；它使用
   `RunInference`/HTTP2 和 `mintLlmGatewayCredential`，因此把模型插入
   Host 目录不能替代本地运行时。

## 方案比较

### A. 修复专用运行时放置门槛（推荐）

改动 `k6f` / glass 的 `LI1`，去掉 `mo.localMode` 前置条件，保留
`useDedicatedLocalAgentRuntimeHost` 设置判断。

优点：

- 直接使用 Cursor 设计的专用本地运行时；
- 官方 Agent Host 和官方推理完全不动；
- 不需要修改 Agent Exec，不需要把自定义模型塞进 Host 后端目录；
- 工具资源仍走现有 composer accessor。

代价：

- 必须修改 workbench 的扩展放置过滤器；
- 运行时扩展会在普通构建中启动一个独立 Extension Host。

### B. 强制启动 Agent Exec 本地 provider

在 Agent Host 启用时额外调用 `cursor-agent-exec` 的 `lH`，让旧本地
provider 注册，再让自定义请求走 `runLocalAgent`。

优点：不依赖专用运行时的放置。

缺点：会改变 Agent Exec 的激活路径，可能重复初始化 Canvas 和工具运行时，
需要额外验证官方 Agent Host 行为。不是首选。

### C. 把自定义模型插入官方 Host 目录

源码证明 Host `managed-local` 走 Cursor 推理端点，第三方 `baseUrl`/`apiKey`
没有进入该路径。目录注入只能绕过 Host 的本地模型判断，不能改变后端协议。
不采用。

## 推荐实施

1. 适配器在两个 workbench bundle 中定位 `k6f`/`LI1`，只把它改成：

   ```js
   function k6f(e) {
     return e?.get("cursor/useDedicatedLocalAgentRuntimeHost", "true") === "true";
   }
   ```

   保留可选的设置判断，默认启用；不改变其他 `localMode` 分支。

2. 自定义模型仍走 `configuredRuntime` 的专用运行时分支；恢复
   `configuredRuntime || ud(...)` 的条件，避免误走旧 Agent Exec。

3. 保留现有的 composer 工具隔离：`createRemoteAccessor` 为自定义模型
   选择独立工具 handler；专用运行时通过 `executeExec` 使用该 accessor。

4. 移除 0.10.3 中未验证的 `cursor-agent-exec` `lH` 补丁，避免额外
   引入旧 provider 生命周期。

## 验证

离线：

- 检查两个 bundle 的 gate 都被替换，且没有其他 `localMode` 改动；
- 加载实际运行时 bundle，调用 `activate()`，确认
  `registerLocalAgentRuntimeProvider` 恰好注册一次；
- 运行现有工具、消息插入、模型路由测试。

安装后：

- 重启 Cursor；
- 确认日志出现 `cursor-local-agent-runtime` 的激活和 provider 注册；
- 发送第三方模型请求，确认出现 `runLocalAgent` 和第三方 `baseUrl`；
- 发送官方模型请求，确认仍走官方 Agent Host。

在安装后验证完成前，不能宣称端到端已修复。
