'use strict';
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { spawnSync, execFile } = require('node:child_process');
const { REVISION, testedVersions, adapters, selectAdapter } = require('./adapters/index.cjs');
const allowedFiles = adapter => new Set([...adapter.BUNDLES, ...adapter.SDK_FILES, 'product.json']);
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const integrity = bytes => crypto.createHash('sha256').update(bytes).digest('base64').replace(/=+$/, '');
const count = (text, needle) => text.split(needle).length - 1;
const json = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const backupDefault = () => path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), 'CursorNativeApi', 'backups');

function atomicWrite(file, bytes) {
  const temp = `${file}.native-api-${crypto.randomUUID()}.tmp`;
  try { fs.writeFileSync(temp, bytes); fs.renameSync(temp, file); }
  finally { if (fs.existsSync(temp)) fs.unlinkSync(temp); }
}

function canonicalRoot(appRoot) {
  const root = fs.realpathSync(appRoot);
  const pkg = json(path.join(root, 'package.json'));
  if (pkg.name !== 'Cursor') throw new Error('所选目录不是 Cursor 的 resources/app。');
  return { root, pkg };
}

function runningPids(appRoot) {
  if (process.platform !== 'win32') return [];
  const exe = path.resolve(appRoot, '..', '..', 'Cursor.exe').replace(/'/g, "''");
  const script = `Get-CimInstance Win32_Process -Filter "Name = 'Cursor.exe'" -ErrorAction Stop | Where-Object { $_.ExecutablePath -eq '${exe}' -and $_.ProcessId -ne ${process.pid} -and $_.CommandLine -notmatch '--type=crashpad-handler|patcher[.]cjs' } | ForEach-Object { $_.ProcessId }`;
  const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { encoding: 'utf8', windowsHide: true, timeout: 15000 });
  if (result.status !== 0 || result.error) throw new Error('无法检查 Cursor 进程；为保护安装目录，停止修改。');
  return result.stdout.trim().split(/\s+/).filter(Boolean).map(Number);
}

function requireClosed(root) {
  if (runningPids(root).length) throw new Error('请先正常退出所有 Cursor 窗口，再运行修改命令。');
}

async function waitForExit(root) {
  const pids = runningPids(root);
  if (!pids.length) return;
  const script = `Get-Process -Id ${pids.join(',')} -ErrorAction SilentlyContinue | Wait-Process -ErrorAction Stop; exit 0`;
  await new Promise((resolve, reject) => execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { windowsHide: true, timeout: 86400000 }, error => error ? reject(error) : resolve()));
}

function plan(appRoot, sourceRoot) {
  const { root, pkg } = canonicalRoot(appRoot);
  sourceRoot ||= root;
  const { SDK_FILES, BUNDLES, OFF, ON, patchWorkbench, patchSdk, patchExtensionHost, resolveConversationActions } = selectAdapter(sourceRoot, root);
  const files = BUNDLES.map(relative => {
    const before = fs.readFileSync(path.join(root, relative));
    const original = fs.readFileSync(path.join(sourceRoot, relative));
    const text = original.toString('utf8');
    if (count(text, OFF) !== 1 || count(text, ON) !== 0) throw new Error(`开关签名不匹配或已被修改：${relative}`);
    let after = text;
    if (/workbench\.(desktop|glass)\.main\.js$/.test(relative)) after = patchWorkbench(after, relative);
    if (/extensionHostProcess\.js$/.test(relative)) after = patchExtensionHost(after);
    return { relative, before, original, after: Buffer.from(after) };
  });
  for (const relative of SDK_FILES) {
    const sourceFile = fs.existsSync(path.join(sourceRoot, relative)) ? path.join(sourceRoot, relative) : path.join(root, relative);
    const original = fs.readFileSync(sourceFile);
    files.push({ relative, before: fs.readFileSync(path.join(root, relative)), original, after: Buffer.from(patchSdk(original.toString('utf8'), relative, { [relative]: resolveConversationActions(sourceRoot, root, relative) })) });
  }
  const productPath = path.join(root, 'product.json');
  const before = fs.readFileSync(productPath);
  const productOriginal = fs.readFileSync(path.join(sourceRoot, 'product.json'));
  const product = JSON.parse(productOriginal.toString('utf8'));
  for (const file of files) {
    if (!file.relative.startsWith('out/')) continue;
    const key = file.relative.slice('out/'.length);
    if (product.checksums?.[key] !== undefined) {
      if (product.checksums[key] !== integrity(file.original)) throw new Error(`原文件校验失败：${file.relative}`);
      product.checksums[key] = integrity(file.after);
    }
  }
  // Keep all release metadata; only update checksums for bundles changed above.
  files.push({ relative: 'product.json', before, original: productOriginal, after: Buffer.from(JSON.stringify(product, null, '\t') + '\n') });
  return { root, version: pkg.version, files };
}

function manifests(backupRoot, appRoot) {
  if (!fs.existsSync(backupRoot)) return [];
  return fs.readdirSync(backupRoot, { withFileTypes: true }).filter(e => e.isDirectory()).map(e => {
    const directory = path.join(backupRoot, e.name);
    const file = path.join(directory, 'manifest.json');
    if (!fs.existsSync(file)) return null;
    const data = json(file);
    return path.resolve(data.appRoot).toLowerCase() === path.resolve(appRoot).toLowerCase() ? { directory, file, data } : null;
  }).filter(Boolean).sort((a, b) => b.data.createdAt.localeCompare(a.data.createdAt));
}

function status(appRoot, backupRoot = backupDefault()) {
  const { root, pkg } = canonicalRoot(appRoot);
  const saved = manifests(backupRoot, root);
  const info = { version: pkg.version, appRoot: root, testedVersions, targetRevision: REVISION, previouslyVerified: testedVersions.includes(pkg.version) };
  const adapter = adapters[0];
  const { BUNDLES, ON, OFF } = adapter;
  const ALLOWED = allowedFiles(adapter);
  const states = BUNDLES.map(relative => {
    const file = path.join(root, relative);
    if (!fs.existsSync(file)) return { file: relative, state: 'missing' };
    const source = fs.readFileSync(file, 'utf8');
    const state = count(source, ON) === 1 && count(source, OFF) === 0 ? 'on' : count(source, OFF) === 1 && count(source, ON) === 0 ? 'off' : 'unknown';
    return { file: relative, state };
  });
  const active = saved.find(m => m.data.version === pkg.version && ['applied', 'prepared', 'recovery-required'].includes(m.data.state));
  let modified = false;
  if (active) modified = active.data.files.some(f => !ALLOWED.has(f.relative) || !fs.existsSync(path.join(root, f.relative)) || sha(fs.readFileSync(path.join(root, f.relative))) !== f.afterHash);
  const sourceRoot = active ? active.directory : root;
  const compatible = adapters.some(candidate => candidate.matches(sourceRoot, root));
  return {
    ...info, supported: compatible,
    revision: active?.data.revision || 1,
    enabled: active?.data.state === 'applied' && !modified,
    state: active?.data.state === 'applied' && modified ? 'changed-after-patch' : active?.data.state || (states.every(s => s.state === 'off') ? 'original' : 'unmanaged'),
    backup: active?.directory, files: states
  };
}

function withLock(backupRoot, fn) {
  fs.mkdirSync(backupRoot, { recursive: true });
  const lock = path.join(backupRoot, 'operation.lock');
  let fd;
  try { fd = fs.openSync(lock, 'wx'); }
  catch { throw new Error(`已有修改任务或遗留锁：${lock}。确认没有任务运行后再移除此锁。`); }
  try { fs.writeSync(fd, String(process.pid)); return fn(); }
  finally { fs.closeSync(fd); fs.unlinkSync(lock); }
}

function apply(appRoot, backupRoot = backupDefault()) {
  return withLock(backupRoot, () => {
    const { root } = canonicalRoot(appRoot);
    requireClosed(root);
    const current = status(root, backupRoot);
    if (current.enabled && current.revision === REVISION) return current;
    if (!current.enabled && current.state !== 'original' && current.state !== 'restored') throw new Error(`当前状态为 ${current.state}；请先检查或恢复备份。`);
    const proposed = plan(root, current.enabled ? current.backup : root);
    const directory = path.join(backupRoot, `${Date.now()}-${crypto.randomUUID()}`);
    fs.mkdirSync(directory, { recursive: true });
    const manifestPath = path.join(directory, 'manifest.json');
    const manifest = { schema: 1, revision: REVISION, appRoot: root, version: proposed.version, createdAt: new Date().toISOString(), state: 'prepared', files: [] };
    for (const file of proposed.files) {
      const saved = path.join(directory, file.relative);
      fs.mkdirSync(path.dirname(saved), { recursive: true });
      fs.writeFileSync(saved, file.original, { flag: 'wx' });
      manifest.files.push({ relative: file.relative, beforeHash: sha(file.original), afterHash: sha(file.after) });
    }
    atomicWrite(manifestPath, JSON.stringify(manifest, null, 2));
    const written = [];
    try {
      for (const file of proposed.files) {
        const target = path.join(root, file.relative);
        if (sha(fs.readFileSync(target)) !== sha(file.before)) throw new Error(`修改前文件发生变化：${file.relative}`);
        atomicWrite(target, file.after);
        written.push(file);
        if (sha(fs.readFileSync(target)) !== sha(file.after)) throw new Error(`写入校验失败：${file.relative}`);
      }
      manifest.state = 'applied';
      atomicWrite(manifestPath, JSON.stringify(manifest, null, 2));
      if (current.enabled) {
        const oldManifestPath = path.join(current.backup, 'manifest.json');
        const oldManifest = json(oldManifestPath); oldManifest.state = 'superseded';
        atomicWrite(oldManifestPath, JSON.stringify(oldManifest, null, 2));
      }
    } catch (error) {
      try {
        for (const file of written.reverse()) atomicWrite(path.join(root, file.relative), file.before);
        manifest.state = 'rolled-back';
      } catch (rollbackError) {
        manifest.state = 'recovery-required';
        error.message += `；自动恢复失败：${rollbackError.message}`;
      }
      atomicWrite(manifestPath, JSON.stringify(manifest, null, 2));
      throw error;
    }
    return status(root, backupRoot);
  });
}

function restore(appRoot, backupRoot = backupDefault()) {
  return withLock(backupRoot, () => {
    const { root, pkg } = canonicalRoot(appRoot);
    requireClosed(root);
    const ALLOWED = allowedFiles(adapters[0]);
    const saved = manifests(backupRoot, root).find(m => m.data.version === pkg.version && ['applied', 'prepared', 'recovery-required'].includes(m.data.state));
    if (!saved) throw new Error('没有可恢复的改造备份。');
    if (pkg.version !== saved.data.version) throw new Error('Cursor 已更新，不能用旧版本备份覆盖新版本。');
    if (saved.data.schema !== 1 || new Set(saved.data.files.map(f => f.relative)).size !== saved.data.files.length) throw new Error('备份清单不完整。');
    const files = saved.data.files.map(file => {
      if (!ALLOWED.has(file.relative)) throw new Error('备份清单包含非法路径。');
      const before = fs.readFileSync(path.join(saved.directory, file.relative));
      const current = fs.readFileSync(path.join(root, file.relative));
      if (sha(before) !== file.beforeHash) throw new Error(`备份已损坏：${file.relative}`);
      if (![file.beforeHash, file.afterHash].includes(sha(current))) throw new Error(`安装文件已被更新或其他工具修改，停止覆盖：${file.relative}`);
      return { relative: file.relative, before, current };
    });
    const written = [];
    try {
      for (const file of files) {
        if (sha(fs.readFileSync(path.join(root, file.relative))) !== sha(file.current)) throw new Error(`恢复前文件发生变化：${file.relative}`);
        atomicWrite(path.join(root, file.relative), file.before);
        written.push(file);
      }
    } catch (error) {
      for (const file of written.reverse()) atomicWrite(path.join(root, file.relative), file.current);
      throw error;
    }
    saved.data.state = 'restored';
    saved.data.restoredAt = new Date().toISOString();
    atomicWrite(saved.file, JSON.stringify(saved.data, null, 2));
    return status(root, backupRoot);
  });
}

async function cli() {
  const args = process.argv.slice(2);
  const option = key => { const i = args.indexOf(key); return i >= 0 ? args[i + 1] : undefined; };
  const action = args[0];
  const appRoot = option('--app-root');
  const backupRoot = option('--backup-root') || backupDefault();
  const jobPath = option('--job');
  const log = data => {
    const entry = { at: new Date().toISOString(), pid: process.pid, revision: REVISION, ...data };
    if (jobPath) atomicWrite(jobPath, JSON.stringify(entry, null, 2));
    else process.stdout.write(JSON.stringify(entry, null, 2) + '\n');
  };
  try {
    if (!appRoot || !['status', 'enable', 'restore', 'plan'].includes(action)) throw new Error('用法：node patcher.cjs status|plan|enable|restore --app-root <Cursor/resources/app> [--backup-root <目录>] [--wait]');
    canonicalRoot(appRoot);
    if (args.includes('--wait')) {
      log({ state: 'waiting-for-exit', action });
      await waitForExit(appRoot);
    }
    const result = action === 'status' ? status(appRoot, backupRoot) : action === 'enable' ? apply(appRoot, backupRoot) : action === 'restore' ? restore(appRoot, backupRoot) : (() => {
      const p = plan(appRoot); return { version: p.version, files: p.files.map(f => ({ file: f.relative, beforeHash: sha(f.before), afterHash: sha(f.after) })) };
    })();
    log({ state: 'completed', action, result });
  } catch (error) { log({ state: 'failed', action, error: error.message }); process.exitCode = 1; }
}

module.exports = { REVISION, testedVersions, plan, apply, restore, status, runningPids, backupDefault, sha, integrity };
if (require.main === module) cli();
