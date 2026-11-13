'use strict';

// Model capabilities are derived during native catalog reads, including startup.
function enrichModel(model, config) {
  const values = config.efforts.length ? [{ value: '', label: '默认' }, ...config.efforts] : [];
  const base = { ...model, namedModelSectionIndex: 1000, cursorNativeApi: true, supportsAgent: true, supportsThinking: values.length > 0, supportsMaxMode: false, supportsNonMaxMode: true, clientDisplayName: config.displayName };
  base.parameterDefinitions = values.length ? [{ id: 'reasoning', name: 'effort', markdownTooltip: '默认使用服务端设置；选择后立即应用到当前会话。', isCycleableByHotkey: true, parameterType: { enumParameter: { values: values.map(({ value, label }) => ({ value, displayName: label })) } } }] : [];
  base.variants = values.map(({ value, label }) => ({ parameterValues: [{ id: 'reasoning', value }], displayName: value ? `${config.displayName} · ${label}` : config.displayName, displayNameOutsidePicker: value ? `${config.displayName} · ${label}` : config.displayName, isMaxMode: false, isDefaultNonMaxConfig: value === config.defaultEffort, variantStringRepresentation: value ? `${model.name}[reasoning=${value}]` : model.name }));
  base.defaultParameterValues = values.length ? [{ id: 'reasoning', value: config.defaultEffort }] : [];
  return base;
}
module.exports = { enrichModel };
