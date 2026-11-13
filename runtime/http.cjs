'use strict';
const https = require('node:https');

// Node's built-in fetch times out on this network stack, while the https module
// with IPv4 connects. Redirects are followed manually because GitHub hands asset
// downloads off to another host.
function request(url, { timeoutMs = 60000 } = {}, redirects = 0) {
  return new Promise((resolve, reject) => {
    const client = https.get(url, { family: 4, headers: { 'User-Agent': 'cursor-native-api' } }, response => {
      if ([301, 302, 303, 307, 308].includes(response.statusCode) && response.headers.location && redirects < 6) {
        response.resume();
        resolve(request(new URL(response.headers.location, url).href, { timeoutMs }, redirects + 1));
        return;
      }
      const chunks = [];
      response.on('data', chunk => chunks.push(chunk));
      response.on('end', () => resolve({ status: response.statusCode, headers: response.headers, body: Buffer.concat(chunks) }));
    });
    client.setTimeout(timeoutMs, () => client.destroy(new Error(`连接 ${new URL(url).host} 超时`)));
    client.on('error', error => reject(new Error(`无法连接 ${new URL(url).host}：${error.code ?? error.message}`)));
  });
}

module.exports = { request };
