# 发布到 GitHub 与自动更新

## 一、自动更新是怎么实现的

GitHub Releases 本身**不会**给直装 VSIX 的扩展提供自动更新——VS Code / Cursor 只从扩展市场（Open VSX 等）拉更新。

所以这个插件自己实现更新：`updater.cjs`

1. 启动 8 秒后检查一次 `https://api.github.com/repos/<owner>/<repo>/releases/latest`，每天最多一次。
2. 版本号比当前新，且 release 里带 `.vsix` 资产时，弹提示“安装并重启”。
3. 下载到扩展全局存储目录，按 release 资产提供的 `sha256` 校验，不一致直接丢弃。
4. 通过内置命令 `workbench.extensions.installExtension` 安装新 VSIX，再由用户点“重新加载窗口”。

手动触发：命令面板 → **检查扩展更新**。

## 二、需要先填的字段

`package.json` 的 `repository.url` 目前是占位符：

```json
"repository": { "type": "git", "url": "https://github.com/REPLACE-ME/cursor-native-api" }
```

改成真实地址后重新打包，更新检查才会指向正确的仓库。

## 三、首次发布步骤

```powershell
# 1. 在 GitHub 网页新建仓库 cursor-native-api（不要勾选初始化 README）
cd C:/Users/suyibin/.codex/visualizations/2026/11/12/01a1cdb3-412f-7fd0-86d3-ed3dd548b6ca/CursorNativeApi
git remote add origin https://github.com/<owner>/cursor-native-api.git
git push -u origin main

# 2. 打标签并上传安装包
git tag v0.9.5
git push origin v0.9.5

# 3a. 有 GitHub CLI（推荐）
gh release create v0.9.5 cursor-native-api-0.9.5.vsix --title "0.9.5" --notes-file CHANGELOG.md

# 3b. 没有 gh：网页打开
# https://github.com/<owner>/cursor-native-api/releases/new?tag=v0.9.5
# 上传 cursor-native-api-0.9.5.vsix 作为资产
```

## 四、后续每次发版

1. 改 `package.json` 的 `version`（例如 0.9.6）与 `npm run package` 的产物名。
2. `npm run package`
3. `git commit -am "0.9.6" && git tag v0.9.6 && git push --follow-tags`
4. `gh release create v0.9.6 cursor-native-api-0.9.6.vsix`

已安装用户下次启动会在一天内收到更新提示。

## 五、注意事项

- 更新只替换插件本身；原生补丁按插件里的 `REVISION` 重新安排，升级后如果提示“退出全部 Cursor 窗口”，需要按提示再完成一次。
- 仓库必须是 **public**，否则未认证的 API 请求拿不到 release。
- 未认证的 GitHub API 限额是每小时 60 次，每天一次的检查远低于上限。
- 资产文件名必须是 `.vsix` 结尾，更新器按后缀挑选资产。
