import type { ResolvedEcwidStoreConfig } from './config'

export type EcwidStoreRoute =
  | { type: 'store' }
  | { type: 'category'; slug: string }
  | { type: 'product'; slug: string }
  | { type: 'search'; query: string }
  | { type: 'cart' }

function join(basePath: string, ...parts: string[]): string {
  const base = basePath === '/' ? '' : basePath
  return `${base}/${parts.map((part) => encodeURIComponent(part)).join('/')}` || '/'
}

function splitSlug(slug: string): string[] {
  return slug
    .split('/')
    .map((part) => part.trim())
    .filter(Boolean)
}

export function storeUrl(config: ResolvedEcwidStoreConfig): string {
  return config.basePath
}

export function categoryUrl(config: ResolvedEcwidStoreConfig, slug: string): string {
  return join(config.basePath, config.routes.category, ...splitSlug(slug))
}

export function productUrl(config: ResolvedEcwidStoreConfig, slug: string): string {
  return join(config.basePath, config.routes.product, slug)
}

export function searchUrl(config: ResolvedEcwidStoreConfig, query: string): string {
  const url = join(config.basePath, config.routes.search)
  const trimmed = query.trim()
  return trimmed ? `${url}?q=${encodeURIComponent(trimmed)}` : url
}

export function cartUrl(config: ResolvedEcwidStoreConfig): string {
  return join(config.basePath, config.routes.cart)
}

export function isEcwidStorePath(config: ResolvedEcwidStoreConfig, pathname: string): boolean {
  return pathname === config.basePath || pathname.startsWith(`${config.basePath === '/' ? '' : config.basePath}/`)
}

export function parseEcwidStoreRoute(
  config: ResolvedEcwidStoreConfig,
  pathname: string,
  searchParams?: URLSearchParams,
): EcwidStoreRoute | null {
  if (!isEcwidStorePath(config, pathname)) return null
  if (pathname === config.basePath || pathname === `${config.basePath}/`) return { type: 'store' }

  const relative = pathname.slice(config.basePath === '/' ? 0 : config.basePath.length).replace(/^\/+|\/+$/g, '')
  const [segment, ...rawValues] = relative.split('/')

  if (segment === config.routes.category && rawValues.length > 0) {
    return { type: 'category', slug: rawValues.map((value) => decodeURIComponent(value)).join('/') }
  }
  if (segment === config.routes.product && rawValues.length === 1) {
    return { type: 'product', slug: decodeURIComponent(rawValues[0]!) }
  }
  if (segment === config.routes.search && rawValues.length === 0) {
    return { type: 'search', query: searchParams?.get('q')?.trim() ?? '' }
  }
  if (segment === config.routes.cart && rawValues.length === 0) return { type: 'cart' }
  return null
}

export function ecwidNavigationKey(route: EcwidStoreRoute): string {
  switch (route.type) {
    case 'store': return 'store'
    case 'category': return `category:${route.slug}`
    case 'product': return `product:${route.slug}`
    case 'search': return `search:${route.query.toLocaleLowerCase()}`
    case 'cart': return 'cart'
  }
}

export function ecwidSearchRobots(): { index: false; follow: true } {
  return { index: false, follow: true }
}

export function ecwidCartRobots(): { index: false; follow: false } {
  return { index: false, follow: false }
}
