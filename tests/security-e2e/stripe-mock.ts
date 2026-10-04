import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';

/** A minimal HTTP stand-in for exactly the Stripe REST endpoints the membership and seminar
 * Checkout flows call (customers.create, checkout.sessions.create/retrieve/listLineItems). The app
 * still runs its real Stripe SDK code: tests/security-e2e/support/outbound-preload.cjs re-points
 * the SDK's api.stripe.com traffic at this server, so request shapes (form encoding, idempotency
 * keys, metadata, amounts) are exercised for real. The hosted Stripe payment page itself is the one
 * thing not reproduced; it is covered by the separate opt-in Stripe test-mode suite
 * (tests/stripe-e2e). `POST /__control/pay/:id` stands in for the shopper completing that page. */

export const STRIPE_MOCK_PORT = 3102;
export const STRIPE_MOCK_URL = `http://127.0.0.1:${STRIPE_MOCK_PORT}`;

type Json = Record<string, unknown>;
type MockSession = Json & { id: string };

/** Decodes Stripe's bracketed form encoding (`a[b][0][c]=1`) into nested objects/arrays. */
export function parseStripeForm(body: string): Json {
  const root: Json = {};
  for (const [key, value] of new URLSearchParams(body)) {
    const path = key.replace(/\]/g, '').split('[');
    let cursor: Record<string, unknown> = root;
    path.forEach((segment, index) => {
      if (index === path.length - 1) { cursor[segment] = value; return; }
      cursor[segment] ??= {};
      cursor = cursor[segment] as Record<string, unknown>;
    });
  }
  return root;
}

function send(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}

async function readBody(req: IncomingMessage) {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString('utf8');
}

export async function startStripeMock(): Promise<{ close: () => Promise<void> }> {
  const sessions = new Map<string, MockSession>();
  const idempotent = new Map<string, MockSession>();
  const customers = new Map<string, Json>();
  let counter = 0;
  const next = (prefix: string) => `${prefix}_e2e${String(++counter).padStart(6, '0')}`;

  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', STRIPE_MOCK_URL);
    const body = await readBody(req);
    const { pathname } = url;

    if (req.method === 'POST' && pathname === '/v1/customers') {
      const form = parseStripeForm(body);
      const id = next('cus');
      const customer = { id, object: 'customer', email: form.email ?? null, metadata: form.metadata ?? {} };
      customers.set(id, customer);
      return send(res, 200, customer);
    }

    if (req.method === 'POST' && pathname === '/v1/checkout/sessions') {
      const key = req.headers['idempotency-key'];
      if (typeof key === 'string' && idempotent.has(key)) return send(res, 200, idempotent.get(key));
      const form = parseStripeForm(body);
      const lineItem = (form.line_items as Record<string, Json> | undefined)?.['0'] as Json | undefined;
      const priceData = (lineItem?.price_data ?? {}) as Json;
      const id = next('cs_test');
      const session: MockSession = {
        amount_total: Number(priceData.unit_amount) * Number(lineItem?.quantity ?? 1),
        currency: priceData.currency, customer: form.customer, expires_at: Math.floor(Date.now() / 1000) + 3600,
        id, line_items_price_data: priceData, metadata: form.metadata ?? {}, mode: form.mode, object: 'checkout.session', customer_email: form.customer_email,
        payment_intent: null, payment_status: 'unpaid', status: 'open', subscription: null,
        success_url: form.success_url, cancel_url: form.cancel_url, url: `https://checkout.stripe.com/c/pay/${id}`,
      };
      sessions.set(id, session);
      if (typeof key === 'string') idempotent.set(key, session);
      return send(res, 200, session);
    }

    const sessionMatch = /^\/v1\/checkout\/sessions\/([^/]+)(\/line_items)?$/.exec(pathname);
    if (req.method === 'GET' && sessionMatch) {
      const session = sessions.get(sessionMatch[1]);
      if (!session) return send(res, 404, { error: { type: 'invalid_request_error', message: 'No such checkout.session' } });
      if (!sessionMatch[2]) return send(res, 200, session);
      const priceData = session.line_items_price_data as Json;
      return send(res, 200, { object: 'list', has_more: false, data: [{
        amount_total: session.amount_total, currency: session.currency, id: next('li'), object: 'item',
        price: { id: next('price'), object: 'price', product: priceData.product ?? next('prod'), unit_amount: priceData.unit_amount },
        quantity: 1,
      }] });
    }

    // Test control: the shopper completes the hosted payment page.
    const payMatch = /^\/__control\/pay\/([^/]+)$/.exec(pathname);
    if (req.method === 'POST' && payMatch) {
      const session = sessions.get(payMatch[1]);
      if (!session) return send(res, 404, { error: 'unknown session' });
      // Stripe collects a guest's contact details on its own page; the shopper's entries arrive here.
      if (body) Object.assign(session, JSON.parse(body) as Json);
      session.status = 'complete';
      session.payment_status = 'paid';
      session.payment_intent ??= next('pi');
      return send(res, 200, session);
    }
    if (req.method === 'GET' && pathname === '/__control/sessions') return send(res, 200, [...sessions.values()]);

    return send(res, 404, { error: { type: 'invalid_request_error', message: `e2e Stripe mock has no ${req.method} ${pathname}` } });
  });

  await new Promise<void>((resolve) => server.listen(STRIPE_MOCK_PORT, '127.0.0.1', resolve));
  return { close: () => new Promise<void>((resolve) => { server.closeAllConnections(); server.close(() => resolve()); }) };
}
