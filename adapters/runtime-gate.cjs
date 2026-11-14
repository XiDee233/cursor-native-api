'use strict';

// The dedicated local-agent runtime is shipped in the app, but its placement is
// gated by a build-only localMode flag. Keep the user/profile setting, but do
// not require the build flag so the runtime can be used on a normal install.
const gatePattern = /function ([\w$]+)\(([\w$]+)\)\{return [\w$]+\.localMode&&\2\?\.get\(([\w$]+),-1\)==="true"\}/g;
function gateMatches(source) {
  gatePattern.lastIndex = 0;
  return [...source.matchAll(gatePattern)].length === 1;
}
function patchRuntimeGate(source) {
  gatePattern.lastIndex = 0;
  const gate = [...source.matchAll(gatePattern)];
  if (gate.length !== 1) throw new Error('Dedicated runtime placement gate signature mismatch');
  // The second argument of IStorageService.get is its scope, not a default.
  // Read the profile-scoped key explicitly; absent means enabled, only an
  // explicit "false" keeps the runtime disabled.
  return source.replace(gatePattern, (_, name, arg, key) => `function ${name}(${arg}){return ${arg}?.get(${key},-1)!=="false"}`);
}

module.exports = { patchRuntimeGate, gateMatches };
