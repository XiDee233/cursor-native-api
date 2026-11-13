'use strict';

const presets = {
  'deepseek-v4.1-flash': { efforts: ['low', 'high', 'max'], origin: 'preset' }
};

function choices(values) {
  return values.map(v => typeof v === 'string' ? { value: v, label: v } : { value: v.value, label: v.label || v.displayName || v.value });
}

function detect(model) {
  const values = model.capabilities?.reasoning_effort || model.reasoning_effort_values;
  const contextLength = model.capabilities?.context_length ?? model.context_length;
  const maxOutputTokens = model.capabilities?.max_output_tokens ?? model.max_output_tokens;
  const limits = {
    ...(Number.isInteger(contextLength) && contextLength > 0 ? { contextLength } : {}),
    ...(Number.isInteger(maxOutputTokens) && maxOutputTokens > 0 ? { maxOutputTokens } : {})
  };
  if (Array.isArray(values)) return { mode: 'auto', origin: 'provider', efforts: choices(values), defaultEffort: '', ...limits };
  const preset = presets[model.id];
  return { mode: 'auto', origin: preset ? 'preset' : 'unknown', efforts: choices(preset?.efforts || []), defaultEffort: '', ...limits };
}

module.exports = { presets: Object.fromEntries(Object.keys(presets).map(id => [id, detect({ id })])), detect };
