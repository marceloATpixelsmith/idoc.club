'use strict';

const fs = require('node:fs');
const dns = require('node:dns');
const net = require('node:net');
const http = require('node:http');
const https = require('node:https');

function deny(kind) {
  const marker = process.env.IDOC_NETWORK_ATTEMPT_FILE;
  if (marker) fs.appendFileSync(marker, `${kind}\n`, { encoding: 'utf8' });
  throw new Error(`BUILD_NETWORK_ACCESS_DENIED:${kind}`);
}

dns.lookup = () => deny('dns.lookup');
dns.resolve = () => deny('dns.resolve');
dns.resolve4 = () => deny('dns.resolve4');
dns.resolve6 = () => deny('dns.resolve6');
const originalConnect = net.Socket.prototype.connect;
net.Socket.prototype.connect = function blockedConnect(...args) {
  const first = args[0];
  if (typeof first === 'string' || first?.path) return originalConnect.apply(this, args);
  if (process.env.IDOC_ALLOW_BUILD_IPC === '1' && new Error().stack?.includes('createIpc')) {
    return originalConnect.apply(this, args);
  }
  return deny('tcp.connect');
};
http.request = () => deny('http.request');
http.get = () => deny('http.get');
https.request = () => deny('https.request');
https.get = () => deny('https.get');
globalThis.fetch = () => deny('fetch');
