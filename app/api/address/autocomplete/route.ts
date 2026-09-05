import 'server-only';

import { getUser } from '@/lib/db/queries';
import { ISO_COUNTRY_CODES } from '@/lib/membership/validation';
import { checkProviderRateLimit, requestOrigin } from '@/lib/security/rate-limit';

type GeoapifyResult = {
  address_line1?: string;
  city?: string;
  country?: string;
  country_code?: string;
  district?: string;
  formatted?: string;
  housenumber?: string;
  postcode?: string;
  state?: string;
  street?: string;
  suburb?: string;
};

type GeoapifyPayload = { results?: GeoapifyResult[] };

const COUNTRY_CODES = new Set<string>(ISO_COUNTRY_CODES);

export async function GET(request: Request) {
  const user = await getUser();
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const text = searchParams.get('text')?.trim() ?? '';
  const country = searchParams.get('country')?.trim().toUpperCase() ?? '';
  const lat = Number(searchParams.get('lat'));
  const lon = Number(searchParams.get('lon'));
  // A bare bias hint, not a hard filter: an out-of-range or absent value is simply not sent to
  // Geoapify, never rejected, since this only ever ranks results the countrycode filter already
  // admits -- it cannot smuggle in a result from the wrong country.
  const hasBias = Number.isFinite(lat) && Number.isFinite(lon) && lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180;

  if (text.length < 3 || text.length > 160 || !COUNTRY_CODES.has(country)) {
    return Response.json({ suggestions: [] });
  }

  const origin = await requestOrigin();
  const allowed = await checkProviderRateLimit('address_autocomplete', String(user.id), origin);
  if (!allowed) {
    return Response.json({ available: false, suggestions: [] }, {
      status: 429,
      headers: { 'Retry-After': '900' },
    });
  }

  const apiKey = process.env.GEOAPIFY_API_KEY?.trim();
  if (!apiKey) {
    return Response.json({ available: false, suggestions: [] }, { status: 503 });
  }

  const endpoint = new URL('https://api.geoapify.com/v1/geocode/autocomplete');
  endpoint.searchParams.set('text', text);
  endpoint.searchParams.set('format', 'json');
  endpoint.searchParams.set('filter', `countrycode:${country.toLowerCase()}`);
  endpoint.searchParams.set('limit', '6');
  endpoint.searchParams.set('lang', 'en');
  if (hasBias) endpoint.searchParams.set('bias', `proximity:${lon},${lat}`);
  endpoint.searchParams.set('apiKey', apiKey);

  try {
    const response = await fetch(endpoint, {
      cache: 'no-store',
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) return Response.json({ available: false, suggestions: [] }, { status: 502 });

    const payload = await response.json() as GeoapifyPayload;
    const suggestions = (payload.results ?? []).map((result) => ({
      addressLine1: result.address_line1 ?? [result.housenumber, result.street].filter(Boolean).join(' '),
      city: result.city ?? '',
      country: result.country ?? '',
      countryCode: result.country_code?.toUpperCase() ?? country,
      // Geoapify's "suburb" is the finer-grained locality below city -- e.g. a Mexican address's
      // colonia -- falling back to "district" when a provider response only carries that instead.
      // Neither is captured by any other field above, so without this it is silently dropped.
      district: result.suburb ?? result.district ?? '',
      formatted: result.formatted ?? result.address_line1 ?? text,
      postalCode: result.postcode ?? '',
      stateProvince: result.state ?? '',
    }));

    return Response.json({ available: true, suggestions });
  } catch {
    return Response.json({ available: false, suggestions: [] }, { status: 502 });
  }
}
