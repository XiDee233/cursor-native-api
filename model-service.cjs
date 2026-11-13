'use strict';
const { detect } = require('./capabilities.cjs');

class ModelService {
  constructor(secrets) { this.secrets = secrets; }
  async request(message) {
    const profile = message.profile;
    const baseUrl = profile.baseUrl.trim().replace(/\/+$/, '');
    new URL(baseUrl);
    const key = message.apiKey.trim() || await this.secrets.get(`provider:${profile.id}`);
    if (!key) throw new Error('请填写 API Key。');
    const reading = message.type === 'models';
    const effort = profile.modelConfigs[profile.modelId]?.defaultEffort;
    const headers = { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' };
    if (new URL(baseUrl).hostname === 'opencode.ai') headers['x-opencode-session'] = `cursor-native-api:${profile.id}`;
    try {
      const response = await fetch(`${baseUrl}/${reading ? 'models' : 'chat/completions'}`, {
        method: reading ? 'GET' : 'POST', redirect: 'error', signal: AbortSignal.timeout(60000),
        headers,
        ...(reading ? {} : { body: JSON.stringify({ model: profile.modelId, messages: [{ role: 'user', content: 'Reply with OK.' }], ...(effort ? { reasoning_effort: effort } : {}), max_tokens: 16, stream: false }) })
      });
      if (!response.ok) throw new Error(`接口返回 HTTP ${response.status}：${(await response.text()).slice(0, 500)}`);
      const data = await response.json();
      return reading
        ? { type: 'models', serviceId: profile.id, requestId: message.requestId, models: data.data.filter(model => typeof model.id === 'string').map(model => ({ id: model.id, name: model.name || model.id, config: detect(model) })) }
        : { type: 'tested', serviceId: profile.id, requestId: message.requestId, message: `连接成功 · ${profile.modelId}\n${String(data.choices?.[0]?.message?.content || '请求成功').slice(0, 200)}` };
    } catch (error) { throw new Error(error.message.split(key).join('[已隐藏 Key]')); }
  }
}

module.exports = { ModelService };
