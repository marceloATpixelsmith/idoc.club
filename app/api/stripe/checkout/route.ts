// This is a return-trip landing page only. Per docs/04 §3, "a completed browser redirect is not
// sufficient" — membership entitlement is granted exclusively by a verified webhook event
// (processStripeEvent), which may not have arrived yet when the browser lands here. This route
// never reads Stripe or mutates the database; it just sends the member somewhere sensible.
export async function GET(request: Request) {
  const sessionId = new URL(request.url).searchParams.get('session_id');
  const destination = sessionId ? '/dashboard?checkout=success' : '/pricing';
  return Response.redirect(new URL(destination, request.url));
}
