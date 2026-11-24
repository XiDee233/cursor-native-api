# 图片分辨率上限补丁实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让自定义模型链路保留长边最多 2000px、5MB 的截图，官方模型发送链路仍保持 Cursor 默认 1024px。

**Architecture:** 新增一个图片上限适配模块，按结构匹配 workbench 的 `ImageUtil` 常量与本地运行时的图片处理常量；在现有 adapter 的 `patchWorkbench` / `patchSdk` / `matches` 中接入。Agent Host 不参与修改。

**Tech Stack:** Node.js CommonJS、现有 `patcher.cjs` 补丁框架、`node:assert` 验证脚本。

**Spec:** `docs/superpowers/specs/2026-11-24-image-resolution-limits-design.md`

## Global Constraints

- 目标常量：`MAX_SIDE = 2000`，`MAX_BYTES = 5242880`。
- 只修改 `out/vs/workbench/workbench.desktop.main.js`、`out/vs/workbench/workbench.glass.main.js`、`extensions/cursor-local-agent-runtime/dist/main.js`。
- 不修改 `extensions/cursor-agent-host/**`。
- 每个签名必须恰好匹配一次；否则抛出明确错误。
- 扩展版本 `0.10.6`，补丁修订 `48`。
- 已测试版本：`3.30.8`、`3.30.14`。

## Review Focus

- Cursor 升级导致 workbench 常量元组缺失或重复：必须拒绝应用，不能静默跳过。
- 本地运行时 fit 函数或字节预算签名变化：必须拒绝应用。
- 图片超过 2000px 或 5MB：本地运行时仍应缩放到限制内，而不是把原图直接发出。
- 官方模型链路：Agent Host 文件必须保持字节不变。
- 已打补丁的源再次进入 patch：`plan()` 始终使用原始备份，patch 函数遇到已修改源应抛错而不是重复处理。

---

### Task 1: 新增图片上限适配模块与验证

**Files:**
- Create: `adapters/image-limits.cjs`
- Test: `validation/image-limits-0.10.6.cjs`

**Interfaces:**
- Produces:
  - `MAX_SIDE: number`（2000）
  - `MAX_BYTES: number`（5242880）
  - `patchWorkbenchImageLimits(source: string): string`
  - `patchRuntimeImageLimits(source: string): string`
  - `workbenchImageLimitMatches(source: string): boolean`
  - `runtimeImageLimitMatches(source: string): boolean`

- [ ] **Step 1: 写失败的验证脚本**

创建 `validation/image-limits-0.10.6.cjs`，覆盖：

```js
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const {
  MAX_SIDE, MAX_BYTES,
  patchWorkbenchImageLimits, patchRuntimeImageLimits,
  workbenchImageLimitMatches, runtimeImageLimitMatches
} = require('../adapters/image-limits.cjs');

const v308 = 'C:/Users/suyibin/AppData/Local/CursorNativeApi/backups/1794584766232-6f92dec0-ab3a-4737-86d5-6c08596fb3b8';
const v314 = 'C:/Users/suyibin/AppData/Local/Temp/opencode/cursor-3.30.14/installed/resources/app';

function check(root, label) {
  for (const kind of ['desktop', 'glass']) {
    const file = `${root}/out/vs/workbench/workbench.${kind}.main.js`;
    const source = fs.readFileSync(file, 'utf8');
    assert.equal(workbenchImageLimitMatches(source), true, `${label} ${kind} signature`);
    const patched = patchWorkbenchImageLimits(source);
    assert.match(patched, /[\w$]+=5242880,[\w$]+=10\*1024\*1024,[\w$]+=2000,[\w$]+=50/, `${label} ${kind} values`);
    assert.doesNotMatch(patched, /[\w$]+=1024\*1024,/, `${label} ${kind} old bytes removed`);
  }
  const runtimeFile = `${root}/extensions/cursor-local-agent-runtime/dist/main.js`;
  const runtime = fs.readFileSync(runtimeFile, 'utf8');
  assert.equal(runtimeImageLimitMatches(runtime), true, `${label} runtime signature`);
  const patched = patchRuntimeImageLimits(runtime);
  assert.match(patched, /function [\w$]+\([\w$]+,[\w$]+,[\w$]+=2000\)\{/, `${label} fit default`);
  assert.match(patched, /const [\w$]+=\([\w$]+,[\w$]+,[\w$]+=2000\)=>/, `${label} alias default`);
  assert.match(patched, /,[\w$]+=5242880,/, `${label} byte budget`);
  assert.doesNotMatch(patched, /,[\w$]+=1048576,/, `${label} old byte budget removed`);
}

assert.equal(MAX_SIDE, 2000);
assert.equal(MAX_BYTES, 5242880);
check(v308, '3.30.8');
check(v314, '3.30.14');

const runtime314 = fs.readFileSync(`${v314}/extensions/cursor-local-agent-runtime/dist/main.js`, 'utf8');
const patchedRuntime = patchRuntimeImageLimits(runtime314);
const fitSource = patchedRuntime.match(/function [\w$]+\([\w$]+,[\w$]+,[\w$]+=2000\)\{[\s\S]*?\}(?=const )/)[0];
const fit = new Function('return ' + fitSource)();
assert.deepEqual(fit(4000, 3000), { width: 2000, height: 1500, needsResize: true });
assert.deepEqual(fit(1024, 768), { width: 1024, height: 768, needsResize: false });
assert.match(patchedRuntime, /for\(;[\w$]+\.length>[\w$]+&&[\w$]+>8&&[\w$]+>8;\)/);

assert.throws(() => patchWorkbenchImageLimits('no image tuple'), /signature/i);
assert.throws(() => patchWorkbenchImageLimits('a=1024*1024,b=10*1024*1024,c=1024,d=50;a=1024*1024,b=10*1024*1024,c=1024,d=50;'), /signature/i);
assert.throws(() => patchRuntimeImageLimits('function x(e,t,n=1024){if(e<1)return{};}'), /signature/i);
console.log('PASS: image limits patch workbench + local runtime for 3.30.8/3.30.14');
```

- [ ] **Step 2: 运行脚本确认失败**

Run: `node validation/image-limits-0.10.6.cjs`
Expected: FAIL，`Cannot find module '../adapters/image-limits.cjs'`。

- [ ] **Step 3: 实现 `adapters/image-limits.cjs`**

实现要点：

- workbench 匹配：

```js
const WORKBENCH = /([\w$]+)=1024\*1024,([\w$]+)=10\*1024\*1024,([\w$]+)=1024,([\w$]+)=50/g;
```

替换为：

```js
`${bytes}=${MAX_BYTES},${maxUpload}=10*1024*1024,${side}=${MAX_SIDE},${misc}=50`
```

- runtime fit 函数匹配：

```js
const RUNTIME_FIT = /function ([\w$]+)\(([\w$]+),([\w$]+),([\w$]+)=1024\)\{if\(\2<1\|\|\3<1\)return\{width:\2,height:\3,needsResize:!1\};/g;
```

只替换匹配文本中的 `=1024){` 为 `=2000){`。

- runtime 别名匹配：

```js
const RUNTIME_ALIAS = /const ([\w$]+)=\(([\w$]+),([\w$]+),([\w$]+)=1024\)=>([\w$]+)\(\2,\3,\4\)/g;
```

只替换匹配文本中的 `=1024)=>` 为 `=2000)=>`。

- runtime 字节预算匹配：

```js
const RUNTIME_BYTES = /,([\w$]+)=1048576,(?=[\w$]+=e=>\{const t=e\.buffer;)/g;
```

替换为 `,${name}=${MAX_BYTES},`。

- 每个 patch 函数先统计匹配数，不是恰好 1 就抛出 `image limits ... signature mismatch`。
- `workbenchImageLimitMatches` 与 `runtimeImageLimitMatches` 用同样的正则统计，恰好 1 才返回 `true`。
- 导出 `MAX_SIDE`、`MAX_BYTES` 及四个函数。

- [ ] **Step 4: 运行脚本确认通过**

Run: `node validation/image-limits-0.10.6.cjs`
Expected: `PASS: image limits patch workbench + local runtime for 3.30.8/3.30.14`

- [ ] **Step 5: 提交**

```bash
git add adapters/image-limits.cjs validation/image-limits-0.10.6.cjs
git commit -m "Add image limit patch adapter"
```

---

### Task 2: 接入现有 adapter 与补丁计划

**Files:**
- Modify: `adapters/cursor-local-agent.cjs`
- Test: `validation/image-limits-0.10.6.cjs`（追加完整计划验证）

**Interfaces:**
- Consumes: Task 1 的 `patchWorkbenchImageLimits`、`patchRuntimeImageLimits`、`workbenchImageLimitMatches`、`runtimeImageLimitMatches`。
- Produces: `plan()` 生成的 workbench/runtime 文件包含 2000/5242880，Agent Host 文件保持不变。

- [ ] **Step 1: 在验证脚本中追加失败断言**

在 `validation/image-limits-0.10.6.cjs` 末尾追加：

```js
const vm = require('node:vm');
const { plan } = require('../patcher.cjs');

(async () => {
  const proposed = plan(v314, v314);
  assert.equal(proposed.files.length, 14);
  for (const file of proposed.files.filter(f => f.relative.endsWith('.js'))) {
    new vm.SourceTextModule(file.after.toString());
  }
  const host = proposed.files.find(f => f.relative === 'extensions/cursor-agent-host/dist/main.js');
  assert.ok(host.after.equals(host.original), 'Agent Host must stay byte-identical');
  const desktop = proposed.files.find(f => f.relative === 'out/vs/workbench/workbench.desktop.main.js').after.toString();
  const runtime = proposed.files.find(f => f.relative === 'extensions/cursor-local-agent-runtime/dist/main.js').after.toString();
  assert.match(desktop, /[\w$]+=5242880,[\w$]+=10\*1024\*1024,[\w$]+=2000,[\w$]+=50/);
  assert.match(runtime, /,[\w$]+=5242880,/);
  console.log('PASS: full patch plan applies image limits and leaves Agent Host unchanged');
})().catch(error => { console.error(error); process.exitCode = 1; });
```

Run: `node --experimental-vm-modules validation/image-limits-0.10.6.cjs`
Expected: FAIL，补丁计划里仍是 1024/1048576，或 Agent Host 被误改。

- [ ] **Step 2: 接入 `patchWorkbench`**

在 `adapters/cursor-local-agent.cjs` 顶部引入：

```js
const {
  patchWorkbenchImageLimits,
  patchRuntimeImageLimits,
  workbenchImageLimitMatches,
  runtimeImageLimitMatches
} = require('./image-limits.cjs');
```

在 `patchWorkbench()` 的 `patchToolWorkbench(source, names)` 之后加入：

```js
source = patchWorkbenchImageLimits(source);
```

- [ ] **Step 3: 接入 `patchSdk`**

在 `patchSdk()` 中，`relative === DEDICATED` 分支的最前面加入：

```js
source = patchRuntimeImageLimits(source);
```

- [ ] **Step 4: 接入 `matches()`**

在 workbench 的 `.every(...)` 条件里加入 `workbenchImageLimitMatches(text)`；在返回值末尾加入 `&& runtimeImageLimitMatches(runtime)`。

- [ ] **Step 5: 运行验证**

Run: `node --experimental-vm-modules validation/image-limits-0.10.6.cjs`
Expected: 两个 PASS。

Run: `node --experimental-vm-modules validation/native-isolation-0.10.0.cjs`
Expected: 现有隔离验证全部 PASS。

Run: `node validation/runtime-gate-0.10.0.cjs`
Expected: 现有 gate 验证全部 PASS。

- [ ] **Step 6: 提交**

```bash
git add adapters/cursor-local-agent.cjs validation/image-limits-0.10.6.cjs
git commit -m "Apply image limits to custom model path"
```

---

### Task 3: 版本、文档、打包与现场验证

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `adapters/index.cjs`
- Modify: `CHANGELOG.md`
- Modify: `README.md`

**Interfaces:**
- Produces: `cursor-native-api-0.10.6.vsix`，补丁修订 48。

- [ ] **Step 1: 升版本与修订**

- `package.json`：`version` 改为 `0.10.6`，打包脚本输出 `cursor-native-api-0.10.6.vsix`。
- `package-lock.json`：根包版本改为 `0.10.6`。
- `adapters/index.cjs`：`REVISION = 48`。

- [ ] **Step 2: 更新文档**

- `README.md` 增加“图片分辨率”说明：自定义模型链路 2000px / 5MB；官方模型发送仍为 1024px；输入框预览为全局 2000px。
- `CHANGELOG.md` 顶部增加 0.10.6 条目。

- [ ] **Step 3: 打包并安装**

Run: `npm run package`
Expected: 生成 `cursor-native-api-0.10.6.vsix`。

Run: `& 'G:/Users/suyibin/AppData/Local/Programs/cursor/resources/app/bin/cursor.cmd' --install-extension 'C:/Users/suyibin/.codex/visualizations/2026/11/12/01a1cdb3-412f-7fd0-86d3-ed3dd548b6ca/CursorNativeApi/cursor-native-api-0.10.6.vsix' --force`
Expected: 安装成功。

- [ ] **Step 4: 应用补丁**

先正常退出全部 Cursor 窗口，然后运行：

```bash
node 'C:/Users/suyibin/.cursor/extensions/local-tools.cursor-native-api-0.10.6/patcher.cjs' enable --app-root 'G:/Users/suyibin/AppData/Local/Programs/cursor/resources/app' --wait
```

Expected: `state: applied`，`revision: 48`。

- [ ] **Step 5: 现场验证**

启动 Cursor，附上一张大于 1MB 的高分辨率截图发给自定义模型，然后：

1. 在 `C:/Users/suyibin/AppData/Roaming/Cursor/User/workspaceStorage/*/images/` 找到最新附件，用 Node 读取 PNG 头，确认长边为 2000。
2. 查看 `Local Agent Runtime.log`，确认请求成功且没有把该图压回 1024px 的 resize 记录。
3. 确认官方模型发送链路未改动：`extensions/cursor-agent-host/dist/2033.js` 的 `1024`/`1048576` 常量仍在。

- [ ] **Step 6: 提交并打包**

```bash
git add package.json package-lock.json adapters/index.cjs CHANGELOG.md README.md docs/superpowers/plans/2026-11-24-image-resolution-limits.md
git commit -m "0.10.6: raise custom model image limits"
```

发布 Release 留到现场验证通过后单独确认。
