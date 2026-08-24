import 'server-only';

import { client } from '@/lib/db/drizzle';
import type { GoogleOidcTransaction, GoogleOidcTransactionStore } from '@/lib/auth/google-oidc-reference';

const RETENTION_MILLISECONDS = 24 * 60 * 60 * 1000;

export async function purgeExpiredGoogleOauthTransactions(now = new Date()) {
  const cutoff = new Date(now.getTime() - RETENTION_MILLISECONDS);
  await client`
    delete from idoc.google_oauth_transactions
    where expires_at < ${cutoff}
       or (consumed_at is not null and consumed_at < ${cutoff})
  `;
}

export const googleOidcTransactionStore: GoogleOidcTransactionStore = {
  async create(transaction) {
    await client`
      insert into idoc.google_oauth_transactions (
        state,
        provider,
        application_id,
        application_origin,
        nonce,
        code_verifier,
        redirect_uri,
        return_to,
        created_at,
        expires_at
      ) values (
        ${transaction.state},
        ${transaction.provider},
        ${transaction.applicationId},
        ${transaction.applicationOrigin},
        ${transaction.nonce},
        ${transaction.codeVerifier},
        ${transaction.redirectUri},
        ${transaction.returnTo},
        ${new Date(transaction.createdAtMs)},
        ${new Date(transaction.expiresAtMs)}
      )
    `;
  },

  async consume(state) {
    const rows = await client<{
      state: string;
      provider: 'google';
      application_id: string;
      application_origin: string;
      nonce: string;
      code_verifier: string;
      redirect_uri: string;
      return_to: string;
      created_at: Date;
      expires_at: Date;
    }[]>`
      update idoc.google_oauth_transactions
      set consumed_at = now()
      where state = ${state}
        and consumed_at is null
      returning
        state,
        provider,
        application_id,
        application_origin,
        nonce,
        code_verifier,
        redirect_uri,
        return_to,
        created_at,
        expires_at
    `;

    const row = rows[0];
    if (!row) return null;

    return {
      provider: row.provider,
      applicationId: row.application_id,
      applicationOrigin: row.application_origin,
      state: row.state,
      nonce: row.nonce,
      codeVerifier: row.code_verifier,
      redirectUri: row.redirect_uri,
      returnTo: row.return_to,
      createdAtMs: row.created_at.getTime(),
      expiresAtMs: row.expires_at.getTime(),
    } satisfies GoogleOidcTransaction;
  },
};
