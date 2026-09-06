export function contentSecurityPolicy(
  nonce: string,
  environment: string | undefined = process.env.NODE_ENV,
): string {
  const developmentEval = environment === 'production' ? '' : " 'unsafe-eval'";
  return [
    "default-src 'self'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "object-src 'none'",
    "img-src 'self' data:",
    `script-src 'self' 'nonce-${nonce}'${developmentEval} https://challenges.cloudflare.com`,
    // Next.js and Tailwind currently emit framework/style attributes without a nonce hook. This is
    // deliberately the sole production unsafe-inline exception; scripts never receive it.
    "style-src 'self' 'unsafe-inline'",
    "connect-src 'self' https://challenges.cloudflare.com",
    'frame-src https://challenges.cloudflare.com',
  ].join('; ');
}
