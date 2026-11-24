'use strict';

// Cursor's image pipeline caps attachments at a max side and a byte budget.
// Custom models keep the higher OpenCode-compatible limits; the official
// Agent Host is deliberately left untouched.
const MAX_SIDE = 2000;
const MAX_BYTES = 5242880;

const WORKBENCH = /([\w$]+)=1024\*1024,([\w$]+)=10\*1024\*1024,([\w$]+)=1024,([\w$]+)=50/g;
const RUNTIME_FIT = /function ([\w$]+)\(([\w$]+),([\w$]+),([\w$]+)=1024\)\{if\(\2<1\|\|\3<1\)return\{width:\2,height:\3,needsResize:!1\};/g;
const RUNTIME_ALIAS = /const ([\w$]+)=\(([\w$]+),([\w$]+),([\w$]+)=1024\)=>([\w$]+)\(\2,\3,\4\)/g;
const RUNTIME_BYTES = /,([\w$]+)=1048576,(?=[\w$]+=e=>\{const t=e\.buffer;)/g;

function countMatches(pattern, source) {
  pattern.lastIndex = 0;
  return [...source.matchAll(pattern)].length;
}

function patchWorkbenchImageLimits(source) {
  if (countMatches(WORKBENCH, source) !== 1) throw new Error('image limits workbench signature mismatch');
  WORKBENCH.lastIndex = 0;
  return source.replace(WORKBENCH, (_, bytes, maxUpload, side, misc) =>
    `${bytes}=${MAX_BYTES},${maxUpload}=10*1024*1024,${side}=${MAX_SIDE},${misc}=50`);
}

function patchRuntimeImageLimits(source) {
  if (countMatches(RUNTIME_FIT, source) !== 1
    || countMatches(RUNTIME_ALIAS, source) !== 1
    || countMatches(RUNTIME_BYTES, source) !== 1) throw new Error('image limits runtime signature mismatch');
  RUNTIME_FIT.lastIndex = 0;
  source = source.replace(RUNTIME_FIT, match => match.replace('=1024){', `=${MAX_SIDE}){`));
  RUNTIME_ALIAS.lastIndex = 0;
  source = source.replace(RUNTIME_ALIAS, match => match.replace('=1024)=>', `=${MAX_SIDE})=>`));
  RUNTIME_BYTES.lastIndex = 0;
  source = source.replace(RUNTIME_BYTES, (_, bytes) => `,${bytes}=${MAX_BYTES},`);
  return source;
}

function workbenchImageLimitMatches(source) {
  return countMatches(WORKBENCH, source) === 1;
}

function runtimeImageLimitMatches(source) {
  return countMatches(RUNTIME_FIT, source) === 1
    && countMatches(RUNTIME_ALIAS, source) === 1
    && countMatches(RUNTIME_BYTES, source) === 1;
}

module.exports = {
  MAX_SIDE,
  MAX_BYTES,
  patchWorkbenchImageLimits,
  patchRuntimeImageLimits,
  workbenchImageLimitMatches,
  runtimeImageLimitMatches
};
