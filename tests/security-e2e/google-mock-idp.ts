import { createHash, randomUUID } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import { exportJWK, generateKeyPair, SignJWT } from 'jose';

/** A minimal, real HTTP implementation of exactly the three Google endpoints
 * `lib/auth/google-oidc-reference.ts` talks to (`/o/oauth2/v2/auth`, `/token`, `/certs`), so the
 * security-e2e suite can drive a genuine browser through the full authorization-code + PKCE + OIDC
 * flow -- real navigation, real cookies, real redirects, a real signed JWT verified against a real
 * JWKS endpoint -- through the actual running Next.js dev server and real Postgres, rather than
 * stubbing the flow at the application layer. `resolveGoogleOidcProvider` (google-oidc-reference.ts)
 * is what points the app at this server instead of the real Google endpoints, and only ever does so
 * for a loopback URL with `VERCEL` unset -- this file has no effect on and is never reachable from a
 * real deployment. */

export const GOOGLE_MOCK_IDP_PORT = 3101;
export const GOOGLE_MOCK_IDP_URL = `http://127.0.0.1:${GOOGLE_MOCK_IDP_PORT}`;

type MockGoogleIdentity = {
  sub: string;
  email: string;
  emailVerified: boolean;
  name: string | null;
  picture: string | null;
};

const DEFAULT_IDENTITY: MockGoogleIdentity = {
  sub: 'mock-google-subject-default',
  email: 'default-mock-identity@security.example.test',
  emailVerified: true,
  name: 'Default Mock Identity',
  picture: null,
};

type PendingAuthorization = {
  clientId: string;
  redirectUri: string;
  nonce: string;
  codeChallenge: string;
  identity: MockGoogleIdentity;
};

async function readBody(req: import('node:http').IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString('utf8');
}

function json(res: import('node:http').ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}

export async function startGoogleMockIdp(): Promise<{ close: () => Promise<void> }> {
  const { privateKey, publicKey } = await generateKeyPair('RS256', { extractable: true });
  const kid = 'mock-google-signing-key-1';
  const jwk = { ...(await exportJWK(publicKey)), alg: 'RS256', kid, use: 'sig' };

  let nextIdentity: MockGoogleIdentity = DEFAULT_IDENTITY;
  const pendingByCode = new Map<string, PendingAuthorization>();

  const server: Server = createServer((req, res) => {
    void (async () => {
      const url = new URL(req.url ?? '/', GOOGLE_MOCK_IDP_URL);

      // Test-only side channel: a spec sets which Google identity the *next* authorization attempt
      // should resolve to. Real Google has no such endpoint; this exists only because the mock
      // server and the Playwright spec that drives it are separate processes with no shared memory.
      if (req.method === 'POST' && url.pathname === '/mock/configure') {
        const body = JSON.parse(await readBody(req)) as Partial<MockGoogleIdentity>;
        nextIdentity = {
          sub: body.sub ?? DEFAULT_IDENTITY.sub,
          email: body.email ?? DEFAULT_IDENTITY.email,
          emailVerified: body.emailVerified ?? true,
          name: body.name ?? null,
          picture: body.picture ?? null,
        };
        json(res, 200, { ok: true });
        return;
      }

      // A real page requiring a navigation, not an auto-redirect: mirrors Google's actual consent
      // screen closely enough that the browser does real cross-origin navigation and cookie handling,
      // consistent with this suite's WebAuthn spec also driving a genuine ceremony rather than a stub.
      if (req.method === 'GET' && url.pathname === '/o/oauth2/v2/auth') {
        const clientId = url.searchParams.get('client_id') ?? '';
        const redirectUri = url.searchParams.get('redirect_uri') ?? '';
        const state = url.searchParams.get('state') ?? '';
        const nonce = url.searchParams.get('nonce') ?? '';
        const codeChallenge = url.searchParams.get('code_challenge') ?? '';
        if (!clientId || !redirectUri || !state) {
          res.writeHead(400, { 'content-type': 'text/plain' });
          res.end('missing required authorization parameters');
          return;
        }
        const code = randomUUID();
        pendingByCode.set(code, { clientId, codeChallenge, identity: nextIdentity, nonce, redirectUri });
        const continueUrl = new URL(redirectUri);
        continueUrl.searchParams.set('code', code);
        continueUrl.searchParams.set('state', state);
        res.writeHead(200, { 'content-type': 'text/html' });
        res.end(`<!doctype html><html><body>
          <p>Mock Google consent screen</p>
          <a id="continue" href="${continueUrl.toString()}">Continue as ${nextIdentity.email}</a>
        </body></html>`);
        return;
      }

      if (req.method === 'POST' && url.pathname === '/token') {
        const body = new URLSearchParams(await readBody(req));
        const code = body.get('code') ?? '';
        const pending = pendingByCode.get(code);
        pendingByCode.delete(code);
        if (!pending) return json(res, 400, { error: 'invalid_grant' });

        const verifier = body.get('code_verifier') ?? '';
        const expectedChallenge = createHash('sha256').update(verifier, 'ascii').digest('base64url');
        if (
          expectedChallenge !== pending.codeChallenge ||
          body.get('redirect_uri') !== pending.redirectUri ||
          body.get('client_id') !== pending.clientId ||
          body.get('grant_type') !== 'authorization_code'
        ) {
          return json(res, 400, { error: 'invalid_grant' });
        }

        const idToken = await new SignJWT({
          email: pending.identity.email,
          email_verified: pending.identity.emailVerified,
          name: pending.identity.name ?? undefined,
          nonce: pending.nonce,
          picture: pending.identity.picture ?? undefined,
        })
          .setProtectedHeader({ alg: 'RS256', kid })
          .setIssuer(GOOGLE_MOCK_IDP_URL)
          .setAudience(pending.clientId)
          .setSubject(pending.identity.sub)
          .setIssuedAt()
          .setExpirationTime('10m')
          .sign(privateKey);

        json(res, 200, { access_token: randomUUID(), expires_in: 3600, id_token: idToken, token_type: 'Bearer' });
        return;
      }

      if (req.method === 'GET' && url.pathname === '/certs') {
        json(res, 200, { keys: [jwk] });
        return;
      }

      res.writeHead(404);
      res.end();
    })().catch(() => {
      if (!res.headersSent) res.writeHead(500);
      res.end();
    });
  });

  await new Promise<void>((resolve) => server.listen(GOOGLE_MOCK_IDP_PORT, '127.0.0.1', resolve));

  return {
    close: () => new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve()))),
  };
}
