'use client';

import { createContext, useContext, type ReactNode } from 'react';

// The token is provided by app/layout.tsx (a Server Component) reading the request-scoped,
// server-issued CSRF cookie via lib/security/csrf.ts's currentCsrfToken() and passing it down as a
// plain prop -- ordinary Server->Client prop passing, not a client-side fetch. Because this
// Provider is rendered as part of the same server-rendered response as every page, React's SSR
// resolves useCsrfToken() in every descendant Client Component to the real value *in the initial
// HTML*, before any client JS runs -- so a plain-<form>, no-JS submission still carries a valid
// token in its hidden field. See components/security/csrf-field.tsx.
const CsrfContext = createContext<string | null>(null);

export function CsrfProvider({ children, token }: { children: ReactNode; token: string | null }) {
  return <CsrfContext.Provider value={token}>{children}</CsrfContext.Provider>;
}

export function useCsrfToken(): string {
  return useContext(CsrfContext) ?? '';
}
