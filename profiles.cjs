'use strict';

class Profiles {
  constructor(context) { this.context = context; }
  get all() { return this.context.globalState.get('profiles', []); }
  async read() {
    return Promise.all(this.all.map(async profile => ({
      ...profile, hasKey: !!await this.context.secrets.get(`provider:${profile.id}`)
    })));
  }
  async save(drafts, apiKeys) {
    const profiles = drafts.map(({ hasKey, ...profile }) => {
      const baseUrl = profile.baseUrl.trim().replace(/\/+$/, '');
      const url = new URL(baseUrl);
      const limit = value => Number.isFinite(Math.floor(Number(value))) && value > 0 ? Math.floor(Number(value)) : 0;
      const modelConfigs = Object.fromEntries(Object.entries(profile.modelConfigs).map(([id, config]) => [id, {
        ...config,
        efforts: config.efforts.map(option => ({ value: option.value, label: option.label || option.value })),
        contextLength: limit(config.contextLength),
        maxOutputTokens: limit(config.maxOutputTokens)
      }]));
      return { ...profile, baseUrl, modelConfigs, name: profile.name || url.hostname };
    });
    for (const profile of profiles) {
      const key = apiKeys[profile.id].trim();
      if (key) await this.context.secrets.store(`provider:${profile.id}`, key);
    }
    const retained = new Set(profiles.map(profile => profile.id));
    for (const profile of this.all) {
      if (!retained.has(profile.id)) await this.context.secrets.delete(`provider:${profile.id}`);
    }
    await this.context.globalState.update('profiles', profiles);
    return profiles;
  }
  async credentials(serviceId) {
    const profile = this.all.find(profile => profile.id === serviceId);
    return { baseUrl: profile.baseUrl, apiKey: await this.secret(serviceId) };
  }
  async secret(serviceId) {
    return this.context.secrets.get(`provider:${serviceId}`);
  }
}

module.exports = { Profiles };
