'use strict';
const adapters = [require('./cursor-local-agent.cjs')];
const REVISION = 30;
const testedVersions = adapters.flatMap(adapter => adapter.testedVersions);
function selectAdapter(root, appRoot = root) {
  const matches = adapters.filter(adapter => adapter.matches(root, appRoot));
  if (matches.length !== 1) throw new Error('当前 Cursor 的接入结构已变化，请更新插件。');
  return matches[0];
}
module.exports = { REVISION, testedVersions, adapters, selectAdapter };
