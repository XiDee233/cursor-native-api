'use strict';
const api = acquireVsCodeApi();
const $ = id => document.getElementById(id);
let profiles = [], presets = {}, selectedServiceId = '', revision = 0, sequence = 0, saving, pluginVersion = '';
const keys = new Map(), catalogs = new Map(), requests = new Map(), keyRequests = new Map(), selections = new Map();
const current = () => profiles.find(profile => profile.id === selectedServiceId);
const emptyConfig = () => ({ mode: 'auto', origin: 'unknown', efforts: [], defaultEffort: '' });
function automatic(serviceId, modelId) {
  const found = catalogs.get(serviceId).find(model => model.id === modelId);
  return found ? found.config : presets[modelId] || emptyConfig();
}
function element(tag, className, text) {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}
function button(text, action, className = 'subtle') {
  const node = element('button', className, text); node.type = 'button'; node.addEventListener('click', action); return node;
}
function changed() { revision++; $('save-state').textContent = '有未保存的更改'; }
function status(message, error = false) { $('status').className = error ? 'error' : ''; $('status').textContent = message; }
function drawServices() {
  $('profiles').replaceChildren();
  for (const profile of profiles) {
    const option = element('option', '', profile.name || '未命名服务');
    option.value = profile.id; $('profiles').append(option);
  }
  $('profiles').value = selectedServiceId;
  $('profiles').disabled = !profiles.length;
  $('remove-service').disabled = !profiles.length;
}
function showService() {
  drawServices();
  const editing = profiles.length > 0;
  $('empty').hidden = editing; $('service-editor').hidden = !editing;
  if (!editing) return;
  const profile = current();
  $('name').value = profile.name; $('baseUrl').value = profile.baseUrl; $('key').value = keys.get(profile.id);
  $('key').type = 'password'; $('toggle-key').textContent = '显示';
  $('toggle-key').disabled = false; delete $('key').dataset.revealed;
  $('key').placeholder = profile.hasKey ? '已保存；填写新 Key 可替换' : '填写 API Key';
  $('key-hint').textContent = profile.hasKey ? '密钥已保存。留空可保留原 Key。' : '密钥保存在编辑器安全存储中。';
  $('manual-model').value = ''; $('model-search').value = '';
  drawDiscovery(); drawModels();
}
function newService() {
  const id = crypto.randomUUID();
  profiles.push({ id, name: '', baseUrl: '', modelId: '', modelConfigs: {}, hasKey: false });
  keys.set(id, ''); catalogs.set(id, []); selections.set(id, new Set());
  selectedServiceId = id; changed(); showService(); $('name').focus(); status('');
}
function removeService() {
  const id = selectedServiceId;
  profiles = profiles.filter(profile => profile.id !== id);
  keys.delete(id); catalogs.delete(id); selections.delete(id); requests.delete(id); keyRequests.delete(id);
  selectedServiceId = profiles.length ? profiles[0].id : '';
  changed(); showService(); status('已移除服务，保存后生效。');
}
function addModel(profile, id, name = id) {
  if (Object.hasOwn(profile.modelConfigs, id)) return false;
  profile.modelConfigs[id] = { ...structuredClone(automatic(profile.id, id)), displayName: name };
  profile.modelId = id; return true;
}
function manualAdd() {
  const id = $('manual-model').value.trim();
  if (!id) { $('manual-model').focus(); return; }
  if (!addModel(current(), id)) { status('这个模型已经添加。'); return; }
  $('manual-model').value = ''; changed(); drawModels(); drawDiscovery(); status('');
}
function request(type, modelId) {
  const profile = structuredClone(current());
  if (modelId !== undefined) profile.modelId = modelId;
  const requestId = ++sequence;
  if (type === 'models') requests.set(profile.id, requestId);
  status(type === 'models' ? '正在读取模型列表…' : '正在测试连接…');
  api.postMessage({ type, requestId, serviceId: profile.id, profile, apiKey: keys.get(profile.id) });
}
function drawDiscovery() {
  const models = catalogs.get(selectedServiceId);
  $('discovery').hidden = models.length === 0;
  const query = $('model-search').value.trim().toLowerCase();
  const configured = current().modelConfigs, selected = selections.get(selectedServiceId);
  const matches = models.filter(model => !Object.hasOwn(configured, model.id) && (model.id + ' ' + model.name).toLowerCase().includes(query));
  $('discovered-models').replaceChildren();
  for (const model of matches) {
    const row = element('label', 'discovered-row'), check = document.createElement('input');
    check.type = 'checkbox'; check.checked = selected.has(model.id);
    check.addEventListener('change', () => {
      if (check.checked) selected.add(model.id); else selected.delete(model.id);
      updateDiscoveryCount();
    });
    row.append(check, element('span', '', model.name === model.id ? model.id : model.id + ' · ' + model.name));
    $('discovered-models').append(row);
  }
  $('select-all').onclick = () => { matches.forEach(model => selected.add(model.id)); drawDiscovery(); };
  $('select-none').onclick = () => { matches.forEach(model => selected.delete(model.id)); drawDiscovery(); };
  updateDiscoveryCount();
}
function updateDiscoveryCount() {
  const count = selections.get(selectedServiceId).size;
  $('discovery-count').textContent = '已选 ' + count + ' 个';
  $('add-selected').textContent = '添加选中模型' + (count ? ' (' + count + ')' : '');
  $('add-selected').disabled = count === 0;
}
function drawModels() {
  const profile = current(), entries = Object.entries(profile.modelConfigs);
  $('model-count').textContent = entries.length + ' 个';
  $('no-models').hidden = entries.length > 0;
  $('model-cards').replaceChildren(...entries.map(([id, config]) => modelCard(profile, id, config)));
}
function modelCard(profile, id, config) {
  const card = element('article', 'model-card'), heading = element('div', 'model-heading');
  heading.append(element('code', '', id), button('移除', () => {
    delete profile.modelConfigs[id];
    if (profile.modelId === id) profile.modelId = Object.keys(profile.modelConfigs)[0] || '';
    changed(); drawModels(); drawDiscovery();
  }, 'subtle danger'));
  const fields = element('div', 'model-fields');
  const name = document.createElement('input'); name.value = config.displayName || id;
  name.addEventListener('input', () => { config.displayName = name.value; changed(); });
  const field = (label, control, wide = false) => {
    const wrapper = element('label', wide ? 'wide' : '');
    wrapper.append(element('span', 'field-label', label), control); fields.append(wrapper);
  };
  field('显示名称', name, true);
  const mode = document.createElement('select');
  for (const [value, label] of [['auto', '自动识别'], ['custom', '自定义选项']]) {
    const option = element('option', '', label); option.value = value; mode.append(option);
  }
  mode.value = config.mode;
  const preferred = document.createElement('select');
  const drawDefault = () => {
    preferred.replaceChildren();
    for (const option of [{ value: '', label: '默认（由服务决定）' }, ...config.efforts]) {
      const item = element('option', '', option.label || option.value); item.value = option.value; preferred.append(item);
    }
    preferred.value = config.defaultEffort;
  };
  drawDefault();
  preferred.addEventListener('change', () => { config.defaultEffort = preferred.value; changed(); });
  mode.addEventListener('change', () => {
    const next = mode.value === 'auto' ? structuredClone(automatic(profile.id, id)) : { ...config, mode: 'custom', origin: 'custom' };
    const selected = config.defaultEffort;
    Object.assign(config, next, { defaultEffort: next.efforts.some(option => option.value === selected) ? selected : '' });
    changed(); drawModels();
  });
  field('推理强度选项', mode); field('默认推理强度', preferred);
  const limit = (label, key, placeholder) => {
    const input = document.createElement('input');
    input.type = 'number'; input.min = '1'; input.step = '1'; input.placeholder = placeholder;
    input.value = config[key] ? String(config[key]) : '';
    input.addEventListener('input', () => {
      const value = Math.floor(Number(input.value));
      config[key] = Number.isFinite(value) && value > 0 ? value : 0;
      changed();
    });
    field(label, input);
  };
  limit('上下文长度（tokens）', 'contextLength', '留空使用服务商默认');
  limit('最大输出（tokens）', 'maxOutputTokens', '留空使用服务商默认');
  card.append(heading, fields);
  if (config.mode === 'custom') {
    const options = element('div', 'effort-options');
    const labels = element('div', 'option-labels');
    labels.append(element('span', '', '接口发送值'), element('span', '', '显示名称'), element('span', ''));
    options.append(labels);
    config.efforts.forEach((option, index) => {
      const row = element('div', 'effort-row'), value = document.createElement('input'), label = document.createElement('input');
      value.value = option.value; value.required = true; value.placeholder = '例如 low'; value.setAttribute('aria-label', '推理强度发送值');
      label.value = option.label; label.placeholder = '例如 low'; label.setAttribute('aria-label', '推理强度显示名称');
      value.addEventListener('input', () => {
        const previous = option.value; option.value = value.value.trim();
        if (config.defaultEffort === previous) config.defaultEffort = option.value;
        changed(); drawDefault();
      });
      label.addEventListener('input', () => { option.label = label.value; changed(); drawDefault(); });
      row.append(value, label, button('×', () => {
        const [removed] = config.efforts.splice(index, 1);
        if (config.defaultEffort === removed.value) config.defaultEffort = '';
        changed(); drawModels();
      }));
      options.append(row);
    });
    options.append(button('＋ 添加强度选项', () => { config.efforts.push({ value: '', label: '' }); changed(); drawModels(); }));
    options.append(element('p', 'hint', '发送值按服务商要求填写，保留大小写。'));
    card.append(options);
  }
  const footer = element('div', 'model-footer');
  const source = config.mode === 'custom' ? '自定义选项' : config.origin === 'provider' ? '服务商提供的选项' : config.origin === 'preset' ? '已识别模型能力' : '服务未声明推理强度，可选择自定义';
  footer.append(element('span', 'hint', config.mode === 'auto' && config.efforts.length ? '可选：' + config.efforts.map(option => option.label).join('、') : source),
    button('测试连接', () => request('test', id)));
  card.append(footer); return card;
}
function showInstallation(install) {
  $('badge').textContent = install.label;
  $('installation-message').hidden = install.ready; $('installation-message').textContent = install.message;
  $('installation-detail').textContent = 'Cursor ' + install.version + ' · 插件 ' + pluginVersion;
  $('install').hidden = !install.canApply; $('restore').hidden = !install.enabled;
}
$('profiles').addEventListener('change', () => { selectedServiceId = $('profiles').value; showService(); status(''); });
$('new').addEventListener('click', newService); $('empty-add').addEventListener('click', newService);
$('remove-service').addEventListener('click', removeService);
$('name').addEventListener('input', () => { current().name = $('name').value; changed(); drawServices(); });
for (const id of ['baseUrl', 'key']) $(id).addEventListener('input', () => {
  const profile = current();
  if (id === 'baseUrl') profile.baseUrl = $('baseUrl').value; else { keys.set(profile.id, $('key').value); delete $('key').dataset.revealed; }
  requests.delete(profile.id); catalogs.set(profile.id, []); selections.set(profile.id, new Set());
  changed(); drawDiscovery();
});
$('toggle-key').addEventListener('click', () => {
  const input = $('key');
  if (input.type === 'text') {
    input.type = 'password'; $('toggle-key').textContent = '显示';
    if (input.dataset.revealed === 'true') { input.value = ''; delete input.dataset.revealed; }
    return;
  }
  if (input.value || !current().hasKey) { input.type = 'text'; $('toggle-key').textContent = '隐藏'; return; }
  const requestId = ++sequence; keyRequests.set(selectedServiceId, requestId);
  $('toggle-key').disabled = true; status('正在读取已保存的 Key…');
  api.postMessage({ type: 'key', serviceId: selectedServiceId, requestId });
});
$('models').addEventListener('click', () => { if ($('baseUrl').reportValidity()) request('models'); });
$('model-search').addEventListener('input', drawDiscovery);
$('add-model').addEventListener('click', manualAdd);
$('manual-model').addEventListener('keydown', event => { if (event.key === 'Enter') manualAdd(); });
$('add-selected').addEventListener('click', () => {
  const profile = current(), selected = selections.get(profile.id);
  for (const model of catalogs.get(profile.id)) if (selected.has(model.id)) addModel(profile, model.id, model.name);
  selected.clear(); changed(); drawModels(); drawDiscovery();
});
$('save').addEventListener('click', () => {
  if (profiles.length && ![...document.querySelectorAll('#service-editor input')].every(input => input.reportValidity())) return;
  saving = { revision, keys: new Map(keys), names: new Map(profiles.map(profile => [profile.id, profile.name])) }; $('save').disabled = true; status('正在保存…');
  api.postMessage({ type: 'save', revision, profiles, apiKeys: Object.fromEntries(keys) });
});
$('install').addEventListener('click', () => api.postMessage({ type: 'install' }));
$('restore').addEventListener('click', () => api.postMessage({ type: 'restore' }));
$('installation-status').addEventListener('click', () => api.postMessage({ type: 'installationStatus' }));
window.addEventListener('message', ({ data }) => {
  if (data.type === 'state') {
    profiles = data.profiles; presets = data.presets;
    for (const profile of profiles) { keys.set(profile.id, ''); catalogs.set(profile.id, []); selections.set(profile.id, new Set()); }
    selectedServiceId = profiles.length ? profiles[0].id : '';
    pluginVersion = data.version;
    showService(); showInstallation(data.installation);
  } else if (data.type === 'saved') {
    $('save').disabled = false;
    for (const profile of profiles) {
      const persisted = data.profiles.find(item => item.id === profile.id);
      if (persisted) {
        profile.hasKey = persisted.hasKey;
        if (profile.name === saving.names.get(profile.id)) {
          profile.name = persisted.name;
          if (profile.id === selectedServiceId) $('name').value = profile.name;
        }
        if (keys.get(profile.id) === saving.keys.get(profile.id)) keys.set(profile.id, '');
      }
    }
    drawServices();
    if (profiles.length) {
      $('key').value = keys.get(selectedServiceId);
      if (!$('key').value) { $('key').type = 'password'; $('toggle-key').textContent = '显示'; delete $('key').dataset.revealed; }
      $('key').placeholder = current().hasKey ? '已保存；填写新 Key 可替换' : '填写 API Key';
      $('key-hint').textContent = current().hasKey ? '密钥已保存。留空可保留原 Key。' : '密钥保存在编辑器安全存储中。';
    }
    $('save-state').textContent = data.revision === revision ? '全部配置已保存' : '有未保存的更改';
    status(data.message);
  } else if (data.type === 'models') {
    if (requests.get(data.serviceId) !== data.requestId) return;
    catalogs.set(data.serviceId, data.models);
    const profile = profiles.find(profile => profile.id === data.serviceId);
    selections.set(data.serviceId, new Set(data.models.filter(model => !Object.hasOwn(profile.modelConfigs, model.id)).map(model => model.id)));
    for (const [id, config] of Object.entries(profile.modelConfigs)) {
      const declared = data.models.find(model => model.id === id);
      if (config.mode === 'auto' && declared && declared.config.origin !== 'unknown') {
        const next = structuredClone(declared.config), preferred = config.defaultEffort;
        Object.assign(config, next, {
          defaultEffort: next.efforts.some(option => option.value === preferred) ? preferred : '',
          contextLength: config.contextLength || next.contextLength || 0,
          maxOutputTokens: config.maxOutputTokens || next.maxOutputTokens || 0
        });
        changed();
      }
    }
    if (data.serviceId === selectedServiceId) {
      drawDiscovery(); drawModels(); status('已读取 ' + data.models.length + ' 个模型，请勾选后添加。');
    }
  } else if (data.type === 'installation') {
    showInstallation(data.installation);
  } else if (data.type === 'key') {
    if (keyRequests.get(data.serviceId) !== data.requestId) return;
    keyRequests.delete(data.serviceId);
    $('toggle-key').disabled = false;
    if (data.serviceId !== selectedServiceId) return;
    if (!data.apiKey) { status('没有找到已保存的 Key，请重新填写。', true); return; }
    $('key').value = data.apiKey; $('key').dataset.revealed = 'true';
    $('key').type = 'text'; $('toggle-key').textContent = '隐藏'; status('');
  } else if (data.type === 'error') {
    if (data.requestType === 'save') $('save').disabled = false;
    if (data.requestType === 'key') { keyRequests.delete(data.serviceId); $('toggle-key').disabled = false; }
    if (data.serviceId !== selectedServiceId) return;
    if (data.requestType === 'models' && requests.get(data.serviceId) !== data.requestId) return;
    status(data.message, true);
  } else if (data.type === 'tested') {
    if (data.serviceId === selectedServiceId) status(data.message);
  } else status(data.message || '');
});
api.postMessage({ type: 'ready' });
