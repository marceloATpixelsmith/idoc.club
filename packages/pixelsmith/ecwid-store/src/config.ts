export interface EcwidRouteSegments {
  category: string
  product: string
  search: string
  cart: string
}

export interface EcwidLocaleDefinition {
  ecwidLocale: string
}

export interface EcwidSearchConfig {
  recentLimit?: number
  popular?: readonly string[]
  showCategoryJumps?: boolean
  categoryJumpIds?: readonly number[]
  storageNamespace?: string
}

export interface EcwidStoreConfig {
  storeId: number
  basePath: string
  routes?: Partial<EcwidRouteSegments>
  locales?: Readonly<Record<string, EcwidLocaleDefinition>>
  defaultLocale?: string
  search?: EcwidSearchConfig
  excludedCategoryIds?: readonly number[]
}

export interface ResolvedEcwidStoreConfig extends Omit<EcwidStoreConfig, 'basePath' | 'routes' | 'search'> {
  basePath: string
  routes: EcwidRouteSegments
  search: Required<Pick<EcwidSearchConfig, 'recentLimit' | 'showCategoryJumps' | 'storageNamespace'>> &
    Pick<EcwidSearchConfig, 'popular' | 'categoryJumpIds'>
}

const DEFAULT_ROUTES: EcwidRouteSegments = {
  category: 'category',
  product: 'product',
  search: 'search',
  cart: 'cart',
}

function cleanPathSegment(segment: string, field: string): string {
  const clean = segment.trim().replace(/^\/+|\/+$/g, '')
  if (!clean || clean.includes('/')) throw new Error(`${field} must be one URL segment.`)
  return clean
}

export function normalizeEcwidBasePath(basePath: string): string {
  const clean = basePath.trim().replace(/^\/+|\/+$/g, '')
  return clean ? `/${clean}` : '/'
}

export function defineEcwidStore(config: EcwidStoreConfig): ResolvedEcwidStoreConfig {
  if (!Number.isSafeInteger(config.storeId) || config.storeId <= 0) {
    throw new Error('Ecwid storeId must be a positive integer.')
  }

  const routes: EcwidRouteSegments = {
    category: cleanPathSegment(config.routes?.category ?? DEFAULT_ROUTES.category, 'routes.category'),
    product: cleanPathSegment(config.routes?.product ?? DEFAULT_ROUTES.product, 'routes.product'),
    search: cleanPathSegment(config.routes?.search ?? DEFAULT_ROUTES.search, 'routes.search'),
    cart: cleanPathSegment(config.routes?.cart ?? DEFAULT_ROUTES.cart, 'routes.cart'),
  }

  const uniqueSegments = new Set(Object.values(routes))
  if (uniqueSegments.size !== Object.keys(routes).length) {
    throw new Error('Ecwid route segments must be unique.')
  }

  return {
    ...config,
    basePath: normalizeEcwidBasePath(config.basePath),
    routes,
    search: {
      recentLimit: Math.max(1, config.search?.recentLimit ?? 5),
      showCategoryJumps: config.search?.showCategoryJumps ?? false,
      storageNamespace: config.search?.storageNamespace ?? `pixelsmith-ecwid-${config.storeId}`,
      popular: config.search?.popular,
      categoryJumpIds: config.search?.categoryJumpIds,
    },
  }
}

export function getEcwidLocale(config: ResolvedEcwidStoreConfig, locale?: string): string | undefined {
  const selected = locale ?? config.defaultLocale
  if (!selected) return undefined
  return config.locales?.[selected]?.ecwidLocale ?? selected
}
