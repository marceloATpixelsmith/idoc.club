import { getUser } from '@/lib/db/queries';
import { ISO_COUNTRY_CODES } from '@/lib/membership/validation';

type GeoapifyResult = {
  address_line1?: string;
  address_line2?: string;
  city?: string;
  country?: string;
  country_code?: string;
  formatted?: string;
  housenumber?: string;
  postcode?: string;
  state?: string;
  street?: string;
};

type GeoapifyPayload = { results?: GeoapifyResult[] };

const COUNTRY_CODES = new Set(ISO_COUNTRY_CODES);

export async function GET(request: Request) {
  const user = await getUser();
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const text = searchParams.get('text')?.trim() ?? '';
  const country = searchParams.get('country')?.trim().toUpperCase() ?? '';

  if (text.length < 3 || text.length > 160 || !COUNTRY_CODES.has(country)) {
    return Response.json({ suggestions: [] });
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
      addressLine2: result.address_line2 ?? '',
      city: result.city ?? '',
      country: result.country ?? '',
      countryCode: result.country_code?.toUpperCase() ?? country,
      formatted: result.formatted ?? result.address_line1 ?? text,
      postalCode: result.postcode ?? '',
      stateProvince: result.state ?? '',
    }));

    return Response.json({ available: true, suggestions });
  } catch {
    return Response.json({ available: false, suggestions: [] }, { status: 502 });
  }
}
