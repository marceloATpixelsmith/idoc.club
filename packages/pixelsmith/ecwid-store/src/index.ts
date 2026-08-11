export {
  defineEcwidStore,
  getEcwidLocale,
  normalizeEcwidBasePath,
  type EcwidLocaleDefinition,
  type EcwidRouteSegments,
  type EcwidSearchConfig,
  type EcwidStoreConfig,
  type ResolvedEcwidStoreConfig,
} from './config'

export {
  cartUrl,
  categoryUrl,
  ecwidCartRobots,
  ecwidNavigationKey,
  ecwidSearchRobots,
  isEcwidStorePath,
  parseEcwidStoreRoute,
  productUrl,
  searchUrl,
  storeUrl,
  type EcwidStoreRoute,
} from './routes'

export {
  ecwidEntityIdFromSlug,
  ecwidEntitySlug,
  ecwidSlugify,
  findEcwidCategoryBySlug,
} from './slugs'

export {
  EcwidCartBridge,
  EcwidMegaMenu,
  EcwidSearchOverlay,
  EcwidStorefront,
  getCachedEcwidCartCount,
  navigateToEcwidCart,
  type EcwidCartBridgeProps,
  type EcwidMegaMenuProps,
  type EcwidPageLoaded,
  type EcwidResolvedTarget,
  type EcwidSearchLabels,
  type EcwidSearchOverlayProps,
  type EcwidStorefrontProps,
} from './client'

export type { EcwidMenuCategory } from './server'
