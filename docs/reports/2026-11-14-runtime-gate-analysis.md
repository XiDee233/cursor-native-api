# Cursor 3.30.8 第三方模型执行链路（源码分析）

分析对象：

- Cursor `3.30.8`
- `resources/app/out/vs/workbench/workbench.desktop.main.js`
- `resources/app/out/vs/workbench/workbench.glass.main.js`
- `resources/app/extensions/cursor-local-agent-runtime/dist/main.js`
- `resources/app/extensions/cursor-agent-host/dist/*`
- `resources/app/extensions/cursor-agent-exec/dist/main.js`

本文只记录源码和日志能直接证明的结论。

## 1. 结论先行

`cursor-local-agent-runtime` 没有被加载，不是扩展清单损坏，也不是没有注册入口。

它被 Cursor 的扩展运行位置过滤器排除：

```js
function k6f(e) {
  return mo.localMode && e?.get(qE0, -1) === "true";
}
```

其中：

```js
qE0 = "cursor/useDedicatedLocalAgentRuntimeHost";
mo.localMode === false; // 普通 Cursor 构建的 buildFlags
```

同一过滤同时出现在两处：

```js
_fanoutGroups = WE0(cursorAgentHostEnabled)
  .filter(group => group.role !== 5 || k6f(this._storageService));
```

```js
function NZa(id, options) {
  return !(
    id === "anysphere.cursor-local-agent-runtime" && !k6f(options.storageService)
    || ...
  );
}
```

`role: 5` 的扩展组正是：

```js
{ role: 5, extensionIds: ["anysphere.cursor-local-agent-runtime"] }
```

因此普通构建中：

1. 扩展仍会被扫描并出现在 builtin cache；
2. `role: 5` 组被过滤掉；
3. 扩展不会被放进任何 Extension Host；
4. `registerLocalAgentRuntimeProvider` 不会执行；
5. `AgentExecProviderService.runLocalAgentInDedicatedExtensionHost()` 等待的 observable 永远不会 fulfilled。

这解释了 0.10.2 请求停在本地运行入口、没有网络请求，也解释了日志里从未出现该扩展的激活记录。

## 2. 扫描与激活是两件事

`CachedProfilesData/__default__profile__/extensions.builtin.cache` 中存在：

```json
{
  "identifier": { "id": "anysphere.cursor-local-agent-runtime" },
  "manifest": {
    "main": "./dist/main",
    "activationEvents": ["*"],
    "extensionKind": ["ui"],
    "private": true
  },
  "isBuiltin": true,
  "isValid": true,
  "targetPlatform": "undefined"
}
```

扫描结果只证明“扩展被发现且清单有效”，不证明“扩展被放入 Extension Host”。

运行位置由 `LZa`（desktop）及其 glass 对应类决定，过滤条件见上。

## 3. 专用运行时本身没有 localMode 依赖

`cursor-local-agent-runtime/dist/main.js` 的导出是：

```js
__webpack_require__.d(__webpack_exports__, { activate: () => v });
```

`v` 中构造本地 `LocalAgentClient`：

```js
new y.LocalAgentClient({
  localProvider: {
    kind: "http",
    endpoints: [{ baseUrl: g.baseUrl, ...(g.apiKey ? { apiKey: g.apiKey } : {}) }]
  },
  defaultModel: w,
  availableModels: () => g.availableModelIds.map(id => new n.Gmx({ modelId: id })),
  ...
})
```

最后执行：

```js
r.subscriptions.push(u.cursor.registerLocalAgentRuntimeProvider(v));
```

在运行时 bundle 中搜索 `localMode` 没有结果。也就是说，它并不要求 `mo.localMode === true` 才能工作；`mo.localMode` 只参与 Cursor 的放置过滤。

已用 Node 加载实际 bundle 并调用导出的 `activate()`：

```json
{"exports":["activate"],"registered":1,"providerKeys":["runLocalAgent"]}
```

这说明扩展的 manifest、入口、`activate` 导出和 provider 注册本身都是正常的，缺的只是放置环节。

## 4. Renderer 侧 provider 注册没有 localMode 门槛

workbench 的 `MainThreadCursor.$registerLocalAgentRuntimeProvider()` 直接注册：

```js
this.agentExecProviderService.registerLocalAgentRuntimeHandler({
  remoteAuthority: null,
  runLocalAgent: async (request, callbacks, resources, signal) => {
    if (resources === undefined)
      throw new Error("Dedicated local agent runtime requires renderer resources");
    const runId = nn();
    this._dedicatedLocalRunCallbacks.set(runId, callbacks);
    this._localAgentControlledExecManagers.set(runId, gcr.fromResources(resources));
    await this._proxy.$startLocalAgentRun(runId, new Bre(request), true, token);
  }
});
```

`AgentExecProviderService` 侧：

```js
async runLocalAgentInDedicatedExtensionHost(request, callbacks, resources, signal) {
  const provider = await ug(this._localAgentRuntimeHandler, signal);
  return provider.runLocalAgent(request, callbacks, resources, signal);
}
```

`_localAgentRuntimeHandler` 初始是一个 `gH` observable；只有上面的 RPC 到达才 fulfilled。源码里没有第二个 `localMode` 条件。

## 5. AgentClientService 如何选择专用运行时

`runLocalAgentInExtensionHost` 结尾：

```js
configuredRuntime || ud(this.storageService, "useDedicatedLocalAgentRuntimeHost")
  ? await this.runLocalAgentInDedicatedExtensionHost(g, v, l, e.signal)
  : await this.agentExecProviderService.runLocalAgent(g, v, e.signal);
```

`ud` 的定义：

```js
function ud(e, t, i) {
  const n = kEt[t];
  const r = e.get(aXt(t), n.storageScope);
  return r ? n.fromStorage(r) : i ?? n.defaultValue;
}
```

`kEt.useDedicatedLocalAgentRuntimeHost = _p(false)`，`aXt(t) = "cursor/" + t`，所以设置键就是：

```text
cursor/useDedicatedLocalAgentRuntimeHost
```

并且 `kEt` 中该设置的默认值是 `false`。

当前自定义模型路径传入了 `configuredRuntime`，因此即使设置项为 false，也应当走专用运行时分支；卡住的原因不是分支选择，而是专用运行时扩展从未被加载。

## 6. 专用运行时如何接工具

`ExtensionHostProcess` 的 `$startLocalAgentRun(runId, request, dedicated, token)` 会按 `dedicated` 选择 provider：

```js
const c = dedicated
  ? await Ve(this._localAgentRuntimeProvider, signal)
  : await Ve(this._agentExecProviderOv, signal);
const l = c.runLocalAgent;
...
await l.call(c, {
  ...request,
  defaultModel,
  modelDetails,
  conversationState,
  action,
  runOptions: { ...request.runOptions, requestedModel, subagentModelOverrides }
}, callbacks, signal);
```

`callbacks.executeExec`：

```js
executeExec: (args, signal) => {
  const streamId = It();
  this._proxy.$startLocalAgentExec(runId, streamId, wrap(args), token);
  // yields the renderer-controlled exec stream
}
```

workbench 的 `$startLocalAgentExec` 使用：

```js
const manager = this._localAgentControlledExecManagers.get(runId);
for await (const response of manager.handle(ctx, message)) {
  await this._proxy.$pushLocalAgentExecStreamChunk(runId, streamId, wrap(frame));
}
```

这个 manager 由 `$registerLocalAgentRuntimeProvider` 中的：

```js
this._localAgentControlledExecManagers.set(runId, gcr.fromResources(resources));
```

创建。也就是说：

- 推理在专用运行时扩展的 Extension Host 内执行；
- 工具执行仍在 renderer 的资源 accessor 上执行；
- 专用运行时通过 `executeExec` RPC 把工具请求送回 renderer；
- 我们的工具隔离只需要保证 renderer 的 `resourceAccessor` 指向第三方工具通道，不需要改专用运行时的推理实现。

## 7. Host 本地 loop 不是第三方 OpenAI 客户端

0.10.1 中已有会话走 Host：

```text
Selected Agent Host turn runtime runtime=managed-local
RunInference attempt opened loop=local_loop
transportMode=http2
last_outbound_message_type=runRequest
ConnectError connectCode=NotFound
AI Model Not Found Unknown model ID: cursor-native-api:...
```

Host 的 `runOnLocalLoop` 调用 `managedLocal.run`，而 `managedLocal` 是 Cursor 的 Agent Host 本地推理适配器；它通过 Connect/HTTP2 把 `runRequest` 发到 Cursor 的推理端点。Host 的 ManagedLocal 请求中还会注入：

```js
clientLlmGatewayCredential: dt
```

其中 `dt` 来自：

```js
h.mintLlmGatewayCredential
```

源码中没有把自定义 `baseUrl/apiKey` 放进 Host ManagedLocal 请求的路径；它不是一个可以接受任意 OpenAI provider 的客户端。

所以：

- 只把自定义模型插入 renderer 的模型菜单，Host 不认识；
- 只把自定义模型插入 Host 的模型目录，Host 后端仍不认识该 model ID；
- 要真正走第三方端点，必须使用 `AgentClientService` 的 `getLocalAgentProviderConfig` + `LocalAgentClient` 本地 HTTP provider，也就是专用运行时或旧 Agent Exec 本地 provider。

## 8. 最优雅的候选方案

从源码看，最小且语义正确的改动不是重写 Host，也不是强行启动旧的 Agent Exec，而是修复专用运行时的放置门槛：

```text
把 k6f（desktop）/ LI1（glass）对 mo.localMode 的依赖去掉，
只保留 cursor/useDedicatedLocalAgentRuntimeHost 设置判断。
```

这样：

- `role: 5` 组会在普通 Cursor 构建中被保留；
- `cursor-local-agent-runtime` 会进入独立 Extension Host；
- 它的 `activate` 会把 `registerLocalAgentRuntimeProvider` 注册到 workbench；
- 自定义模型仍然走现有专用运行时分支；
- 官方 Agent Host、官方模型和现有工具链不需要改。

还需要确认设置键的写入时机：该设置必须在 Extension Host 启动前已经持久化为 `"true"`。最稳妥的做法是插件在安装/保存配置时通过 `IStorageService.store("cursor/useDedicatedLocalAgentRuntimeHost", "true", -1, 0)` 写入，然后由用户完成一次重启。

## 9. 已落地的 gate 补丁

`adapters/runtime-gate.cjs` 已在两个 workbench bundle 中定位并替换门控：

```js
function k6f(e) { return e?.get("cursor/useDedicatedLocalAgentRuntimeHost", "true") === "true"; }
function LI1(t) { return t?.get("cursor/useDedicatedLocalAgentRuntimeHost", "true") === "true"; }
```

生成的 desktop/glass bundle 都通过了语法解析。

`validation/runtime-gate-0.10.0.cjs` 还从补丁后的源码中提取并执行了：

- `LZa` 的构造逻辑：`role: 5` 组被保留；
- `NativeExtensionHostFactory.createExtensionHost`：以 `role: 5` 创建本地 Extension Host；
- 实际运行时 bundle 的 `activate()`：注册 `runLocalAgent` provider。

这里有一个必须记录的实际问题：`IStorageService.get` 的第二个参数是 **storage scope**，不是默认值。0.10.3 曾把它写成：

```js
e?.get(qE0, "true") === "true"
```

`"true"` 被当作 scope，导致设置读不到，role:5 仍然被过滤。0.10.4 改为：

```js
e?.get(qE0, -1) !== "false"
```

缺省（undefined）启用，只有显式写入 `"false"` 才关闭。这是 0.10.3 日志中没有 role:5 Extension Host 的直接原因。

输出：

```text
PASS: k6f patch removes the build-only localMode gate and keeps the setting
PASS: LI1 patch removes the build-only localMode gate and keeps the setting
PASS: patched LZa placement construction includes role:5 and maps its affinity to Extension Host role 5
PASS: patched factory creates a local Extension Host with role 5 for the runtime affinity
PASS: runtime bundle activates without localMode and registers exactly runLocalAgent
```

## 10. 尚未证明的部分

以下必须在真实安装后验证，不能仅靠离线源码断言：

1. `k6f` 改为读取设置后，`role: 5` Extension Host 是否按预期启动；
2. 专用运行时是否能在普通构建中完成 `LocalAgentClient` 初始化；
3. 专用运行时的 `resourceAccessor` 是否能把工具会话和消息插入完整接到当前 composer。

在未完成这些验证前，不应把该方案标记为已修复。
