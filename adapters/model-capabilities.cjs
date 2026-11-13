'use strict';

function patchModelCapabilities(source) {
  const field = /configuredEffortValues:([\w$]+)\.configuredEffortValues/;
  const index = source.search(field);
  const metadata = [...source.slice(0, index).matchAll(/metadata:([\w$]+)\}/g)].at(-1)[1];
  return source.replace(field, (_, options) => `configuredEffortValues:${options}.configuredEffortValues??${metadata}.reasoningEffortValues`);
}

module.exports = { patchModelCapabilities };
