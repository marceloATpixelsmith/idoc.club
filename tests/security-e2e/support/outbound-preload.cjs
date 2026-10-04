'use strict';

// Loaded into the security-e2e Next.js dev server through NODE_OPTIONS=--require (see
// playwright.security.config.ts). It replaces the four external providers this suite must never
// contact -- Cloudflare Turnstile, Brevo transactional email, the HaveIBeenPwned range API, and
// Stripe -- with deterministic local stand-ins, WITHOUT any test-only branch inside application
// code: the app still executes its real verifyTurnstile / sendTransactionalEmail /
// checkPasswordBreached / Stripe SDK paths, and only the network edge is redirected.
//
//   - Turnstile: token `e2e-pass:<action>` verifies as that action on the app's own hostname;
//     any other token is rejected, so the real hostname/action equality checks still run.
//   - Brevo: every accepted message is appended as one JSON line to E2E_MAIL_SINK so specs can read
//     the real OTP / link the app generated. Control `brevo: "fail"` makes Brevo return HTTP 500.
//   - HIBP: answers a genuine k-anonymity range response for the passwords listed in the control
//     file (`hibp.passwords`); `hibp.mode: "unavailable"` returns HTTP 503 (the documented fail-open
//     path). The control file is re-read on every call so a spec can change behavior mid-run.
//   - Stripe: api.stripe.com HTTPS traffic from the Stripe SDK is re-pointed at the local Stripe
//     mock (tests/security-e2e/stripe-mock.ts) on STRIPE_MOCK_PORT.
//
// This file is only ever referenced by playwright.security.config.ts; nothing in the application
// imports it, and it is inert unless that config sets NODE_OPTIONS.

const fs = require('node:fs');
const http = require('node:http');
const https = require('node:https');
const { createHash } = require('node:crypto');

const mailSink = process.env.E2E_MAIL_SINK;
const controlFile = process.env.E2E_CONTROL_FILE;
const stripeMockPort = Number(process.env.STRIPE_MOCK_PORT || 0);
const appHostname = (() => { try { return new URL(process.env.BASE_URL).hostname; } catch { return '127.0.0.1'; } })();

function control() {
  try { return JSON.parse(fs.readFileSync(controlFile, 'utf8')); } catch { return {}; }
}
function jsonResponse(status, body) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

const realFetch = globalThis.fetch;
globalThis.fetch = async function e2eFetch(input, init) {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;

  if (url.startsWith('https://challenges.cloudflare.com/turnstile/v0/siteverify')) {
    const params = new URLSearchParams(String(init && init.body));
    const token = params.get('response') || '';
    const match = /^e2e-pass:(.+)$/.exec(token);
    return match
      ? jsonResponse(200, { success: true, hostname: appHostname, action: match[1] })
      : jsonResponse(200, { success: false, 'error-codes': ['invalid-input-response'] });
  }

  if (url.startsWith('https://api.brevo.com/v3/smtp/email')) {
    if (control().brevo === 'fail') return jsonResponse(500, { message: 'e2e simulated Brevo outage' });
    const message = JSON.parse(String(init && init.body));
    if (mailSink) {
      fs.appendFileSync(mailSink, `${JSON.stringify({
        html: message.htmlContent, receivedAt: new Date().toISOString(), subject: message.subject,
        to: (message.to && message.to[0] && message.to[0].email) || '',
      })}\n`);
    }
    return jsonResponse(201, { messageId: `<e2e-${Date.now()}@brevo.invalid>` });
  }

  if (url.startsWith('https://api.pwnedpasswords.com/range/')) {
    const state = control().hibp || {};
    if (state.mode === 'unavailable') return new Response('unavailable', { status: 503 });
    const prefix = url.slice('https://api.pwnedpasswords.com/range/'.length).toUpperCase();
    const lines = (state.passwords || [])
      .map((password) => createHash('sha1').update(password, 'utf8').digest('hex').toUpperCase())
      .filter((hash) => hash.startsWith(prefix))
      .map((hash) => `${hash.slice(5)}:42`);
    return new Response(lines.join('\r\n'), { status: 200, headers: { 'content-type': 'text/plain' } });
  }

  return realFetch(input, init);
};

if (stripeMockPort) {
  const realHttpsRequest = https.request;
  https.request = function e2eHttpsRequest(options, ...rest) {
    if (options && typeof options === 'object' && !(options instanceof URL) && options.host === 'api.stripe.com') {
      const { agent: _agent, ciphers: _ciphers, ...passthrough } = options;
      const request = http.request({ ...passthrough, host: '127.0.0.1', port: stripeMockPort }, ...rest);
      // The Stripe SDK believes this is a TLS connection and only writes its body once the socket
      // reports 'secureConnect'; a plain-HTTP socket emits 'connect' instead.
      request.on('socket', (socket) => socket.once('connect', () => socket.emit('secureConnect')));
      return request;
    }
    return realHttpsRequest.call(https, options, ...rest);
  };
}
