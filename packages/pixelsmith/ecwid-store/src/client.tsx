'use client'

import Link from 'next/link'
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import type { ResolvedEcwidStoreConfig } from './config'
import { getEcwidLocale } from './config'
import type { EcwidMenuCategory } from './server'
import { ecwidEntitySlug } from './slugs'
import {
  cartUrl,
  categoryUrl,
  isEcwidStorePath,
  parseEcwidStoreRoute,
  productUrl,
  searchUrl,
  storeUrl,
  type EcwidStoreRoute,
} from './routes'

declare global {
  interface Window {
    ecwid_script_defer?: boolean
    ecwid_dynamic_widgets?: boolean
    xProductBrowser?: (...args: string[]) => void
    Ecwid?: {
      openPage?: (page: string, options?: Record<string, unknown>) => void
      OnPageLoaded?: { add: (callback: (page: EcwidPageLoaded) => void) => void }
      OnCartChanged?: { add: (callback: (cart: { productsQuantity?: number }) => void) => void }
      Cart?: { get: (callback: (cart: { productsQuantity?: number }) => void) => void }
    }
  }
}

export interface EcwidPageLoaded {
  type?: string
  categoryId?: number
  productId?: number
  keywords?: string
  keyword?: string
  [key: string]: unknown
}

export interface EcwidResolvedTarget {
  route: EcwidStoreRoute
  categoryId?: number
  productId?: number
}

export interface EcwidStorefrontProps {
  config: ResolvedEcwidStoreConfig
  locale?: string
  target?: EcwidResolvedTarget | null
  className?: string
  loading?: ReactNode
  productSlugById?: (productId: number) => Promise<string | null>
  categorySlugById?: (categoryId: number) => Promise<string | null>
  onPageLoaded?: (page: EcwidPageLoaded) => void
  browserOptions?: readonly string[]
}

const SCRIPT_PREFIX = 'pixelsmith-ecwid-script-'
const DEFAULT_BROWSER_OPTIONS: readonly string[] = []

function routeToEcwid(target: EcwidResolvedTarget): [string, Record<string, unknown> | undefined] {
  switch (target.route.type) {
    case 'store': return ['category', { id: 0 }]
    case 'category': return ['category', target.categoryId ? { id: target.categoryId } : undefined]
    case 'product': return ['product', target.productId ? { id: target.productId } : undefined]
    case 'search': return ['search', { keyword: target.route.query }]
    case 'cart': return ['cart', undefined]
  }
}

function pageMatchesTarget(page: EcwidPageLoaded, target: EcwidResolvedTarget): boolean {
  const type = page.type?.toUpperCase()
  switch (target.route.type) {
    case 'store': return type === 'CATEGORY' && (!page.categoryId || page.categoryId === 0)
    case 'category': return type === 'CATEGORY' && (!target.categoryId || page.categoryId === target.categoryId)
    case 'product': return type === 'PRODUCT' && (!target.productId || page.productId === target.productId)
    case 'cart': return type === 'CART'
    case 'search': {
      if (type !== 'SEARCH') return false
      const echoed = (page.keywords ?? page.keyword)?.trim().toLocaleLowerCase()
      return !echoed || echoed === target.route.query.trim().toLocaleLowerCase()
    }
  }
}

function markHistory(phase: 'pre' | 'final', key: string) {
  const state = typeof window.history.state === 'object' && window.history.state ? window.history.state : {}
  window.history.replaceState({ ...state, pixelsmithEcwid: { phase, key } }, '', window.location.href)
}

function readStorage(storage: Storage, key: string): string | null {
  try { return storage.getItem(key) } catch { return null }
}

function writeStorage(storage: Storage, key: string, value: string): void {
  try { storage.setItem(key, value) } catch { /* Persistence is optional. */ }
}

function removeStorage(storage: Storage, key: string): void {
  try { storage.removeItem(key) } catch { /* Persistence is optional. */ }
}

export function EcwidStorefront({
  config,
  locale,
  target,
  className = '',
  loading = 'Loading the shop…',
  productSlugById,
  categorySlugById,
  onPageLoaded,
  browserOptions = DEFAULT_BROWSER_OPTIONS,
}: EcwidStorefrontProps) {
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const router = useRouter()
  const mountId = `my-store-${config.storeId}`
  const [ready, setReady] = useState(false)
  const activeTarget = useMemo<EcwidResolvedTarget | null>(() => {
    if (target === null) return null
    if (target) return target
    const parsed = parseEcwidStoreRoute(config, pathname, new URLSearchParams(searchParams.toString()))
    return parsed ? { route: parsed } : null
  }, [config, pathname, searchParams, target])
  const targetRef = useRef<EcwidResolvedTarget | null>(activeTarget)
  targetRef.current = activeTarget

  useEffect(() => {
    const scriptId = `${SCRIPT_PREFIX}${config.storeId}`
    const existing = document.getElementById(scriptId) as HTMLScriptElement | null

    function initialize() {
      const productBrowser = window.xProductBrowser
      if (!productBrowser) return
      const localeOption = getEcwidLocale(config, locale)
      const options = [
        `id=${mountId}`,
        ...(localeOption ? [`lang=${localeOption}`] : []),
        ...browserOptions,
      ]
      productBrowser(...options)
      setReady(true)
    }

    window.ecwid_script_defer = true
    window.ecwid_dynamic_widgets = true
    if (existing) {
      if (window.xProductBrowser) initialize()
      else existing.addEventListener('load', initialize, { once: true })
      return () => existing.removeEventListener('load', initialize)
    }

    const script = document.createElement('script')
    script.id = scriptId
    script.src = `https://app.ecwid.com/script.js?${config.storeId}&data_platform=code&data_date=2026-01-01`
    script.async = true
    script.charset = 'utf-8'
    script.addEventListener('load', initialize, { once: true })
    document.head.appendChild(script)
    return () => script.removeEventListener('load', initialize)
  }, [browserOptions, config, locale, mountId])

  useEffect(() => {
    const openPage = window.Ecwid?.openPage
    if (!ready || !openPage || !activeTarget) return
    const [page, options] = routeToEcwid(activeTarget)
    if ((activeTarget.route.type === 'category' && !activeTarget.categoryId) ||
        (activeTarget.route.type === 'product' && !activeTarget.productId)) return
    const key = JSON.stringify(activeTarget)
    markHistory('pre', key)
    openPage(page, options)
  }, [activeTarget, ready])

  useEffect(() => {
    const onPageLoadedEvent = window.Ecwid?.OnPageLoaded
    if (!ready || !onPageLoadedEvent) return
    const searchReturnKey = `${config.search.storageNamespace}:search-return`

    const handlePageLoaded = (page: EcwidPageLoaded) => {
      const current = targetRef.current
      onPageLoaded?.(page)
      if (!current || !pageMatchesTarget(page, current)) return

      const key = JSON.stringify(current)
      const cleanUrl = `${window.location.pathname}${window.location.search}`
      if (window.location.hash) window.history.replaceState(window.history.state, '', cleanUrl)
      markHistory('final', key)

      if (current.route.type === 'product' && current.productId && productSlugById) {
        void productSlugById(current.productId).then((slug) => {
          if (slug) router.replace(productUrl(config, slug), { scroll: false })
        }).catch(() => undefined)
      } else if (current.route.type === 'category' && current.categoryId && categorySlugById) {
        void categorySlugById(current.categoryId).then((slug) => {
          if (slug) router.replace(categoryUrl(config, slug), { scroll: false })
        }).catch(() => undefined)
      }
    }

    onPageLoadedEvent.add(handlePageLoaded)

    const clickHandler = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
      const anchor = (event.target as Element | null)?.closest('a[href]') as HTMLAnchorElement | null
      if (!anchor) return

      const currentRoute = parseEcwidStoreRoute(config, window.location.pathname, new URLSearchParams(window.location.search))
      const rawHref = anchor.getAttribute('href')?.trim() ?? ''
      const isStoreBreadcrumb = currentRoute?.type === 'category'
        && anchor.matches('.breadcrumbs__link')
        && !rawHref
      if (isStoreBreadcrumb) {
        event.preventDefault()
        event.stopPropagation()
        event.stopImmediatePropagation()
        if (window.history.length > 1) router.back()
        else router.push(storeUrl(config))
        return
      }

      const hashId = rawHref.match(/#!\/.*\/p\/(\d+)/)?.[1]
      const pathId = rawHref.match(/-p(\d+)(?:[/?#]|$)/)?.[1]
      const productId = Number(hashId ?? pathId)
      if (!Number.isSafeInteger(productId) || productId <= 0 || !productSlugById) return
      event.preventDefault()
      event.stopPropagation()
      event.stopImmediatePropagation()

      if (currentRoute?.type === 'search') {
        writeStorage(window.sessionStorage, searchReturnKey, `${window.location.pathname}${window.location.search}`)
      } else {
        removeStorage(window.sessionStorage, searchReturnKey)
      }

      const openNativeProduct = () => window.Ecwid?.openPage?.('product', { id: productId })
      void productSlugById(productId)
        .then((slug) => {
          if (slug) router.push(productUrl(config, slug))
          else openNativeProduct()
        })
        .catch(openNativeProduct)
    }

    document.addEventListener('click', clickHandler, true)
    return () => document.removeEventListener('click', clickHandler, true)
  }, [categorySlugById, config, onPageLoaded, productSlugById, ready, router])

  useEffect(() => {
    const searchReturnKey = `${config.search.storageNamespace}:search-return`
    const handlePopState = () => {
      if (window.location.hash) {
        window.history.replaceState(window.history.state, '', `${window.location.pathname}${window.location.search}`)
      }

      const searchReturnUrl = readStorage(window.sessionStorage, searchReturnKey)
      if (searchReturnUrl && searchReturnUrl.startsWith(`${config.basePath}/${config.routes.search}?`) &&
          !window.location.pathname.startsWith(`${config.basePath}/${config.routes.product}/`)) {
        removeStorage(window.sessionStorage, searchReturnKey)
        const restored = `${window.location.pathname}${window.location.search}`
        if (restored === searchReturnUrl && !window.location.hash) window.location.reload()
        else window.location.replace(searchReturnUrl)
        return
      }

      const state = window.history.state?.pixelsmithEcwid as { phase?: string } | undefined
      if (state?.phase === 'pre') window.history.back()
    }
    window.addEventListener('popstate', handlePopState)
    return () => window.removeEventListener('popstate', handlePopState)
  }, [config])

  return (
    <div className={`pixelsmith-ecwid-storefront ${className}`.trim()} data-ready={ready ? 'true' : 'false'}>
      {!ready ? <div className="pixelsmith-ecwid-storefront__loading">{loading}</div> : null}
      <div id={mountId} />
    </div>
  )
}

export interface EcwidSearchLabels {
  title: string
  placeholder: string
  submit: string
  clear: string
  close: string
  recent: string
  popular?: string
  categories?: string
}

export interface EcwidSearchOverlayProps {
  config: ResolvedEcwidStoreConfig
  open: boolean
  onOpenChange: (open: boolean) => void
  labels: EcwidSearchLabels
  categories?: readonly EcwidMenuCategory[]
  categoryHref?: (category: EcwidMenuCategory) => string
  className?: string
}

function readStoredList(key: string): string[] {
  try {
    const parsed = JSON.parse(readStorage(window.localStorage, key) ?? '[]') as unknown
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : []
  } catch {
    return []
  }
}

export function EcwidSearchOverlay({
  config,
  open,
  onOpenChange,
  labels,
  categories = [],
  categoryHref = (category) => categoryUrl(config, ecwidEntitySlug(category.name, category.id)),
  className = '',
}: EcwidSearchOverlayProps) {
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const router = useRouter()
  const activeKey = `${config.search.storageNamespace}:active-search`
  const recentKey = `${config.search.storageNamespace}:recent-searches`
  const [value, setValue] = useState('')
  const [recent, setRecent] = useState<string[]>([])

  useEffect(() => {
    if (!open) return
    const query = searchParams.get('q')?.trim()
    setValue(query || readStorage(window.localStorage, activeKey) || '')
    setRecent(readStoredList(recentKey).slice(0, config.search.recentLimit))
  }, [activeKey, config.search.recentLimit, open, recentKey, searchParams])

  function execute(raw: string) {
    const query = raw.trim()
    if (!query) return
    const updated = [query, ...recent.filter((item) => item.toLocaleLowerCase() !== query.toLocaleLowerCase())]
      .slice(0, config.search.recentLimit)
    writeStorage(window.localStorage, activeKey, query)
    writeStorage(window.localStorage, recentKey, JSON.stringify(updated))
    setRecent(updated)
    onOpenChange(false)
    const url = searchUrl(config, query)
    if (isEcwidStorePath(config, pathname)) window.location.assign(url)
    else router.push(url)
  }

  function clearActive() {
    removeStorage(window.localStorage, activeKey)
    setValue('')
    onOpenChange(false)
    const url = storeUrl(config)
    if (isEcwidStorePath(config, pathname)) window.location.assign(url)
    else router.push(url)
  }

  if (!open) return null

  const allowedJumpIds = config.search.categoryJumpIds ? new Set(config.search.categoryJumpIds) : null
  const jumps = categories.filter((category) => !allowedJumpIds || allowedJumpIds.has(category.id))

  return (
    <div className={`pixelsmith-ecwid-search ${className}`.trim()} role="dialog" aria-modal="true" aria-label={labels.title}>
      <button className="pixelsmith-ecwid-search__backdrop" aria-label={labels.close} onClick={() => onOpenChange(false)} />
      <div className="pixelsmith-ecwid-search__panel">
        <div className="pixelsmith-ecwid-search__topline">
          <h2>{labels.title}</h2>
          <button type="button" onClick={() => onOpenChange(false)} aria-label={labels.close}>×</button>
        </div>
        <form onSubmit={(event) => { event.preventDefault(); execute(value) }} className="pixelsmith-ecwid-search__form">
          <input value={value} onChange={(event) => setValue(event.target.value)} placeholder={labels.placeholder} autoFocus />
          {value ? <button type="button" onClick={() => setValue('')} aria-label={labels.clear}>×</button> : null}
          <button type="submit">{labels.submit}</button>
        </form>
        {recent.length > 0 ? (
          <section className="pixelsmith-ecwid-search__section">
            <h3>{labels.recent}</h3>
            <div className="pixelsmith-ecwid-search__pills">
              {recent.map((term) => <button type="button" key={term} onClick={() => execute(term)}><span aria-hidden="true">◷</span>{term}</button>)}
            </div>
          </section>
        ) : null}
        {(config.search.popular?.length ?? 0) > 0 ? (
          <section className="pixelsmith-ecwid-search__section">
            <h3>{labels.popular}</h3>
            <div className="pixelsmith-ecwid-search__pills">
              {config.search.popular?.map((term) => <button type="button" key={term} onClick={() => execute(term)}>{term}</button>)}
            </div>
          </section>
        ) : null}
        {config.search.showCategoryJumps && jumps.length > 0 ? (
          <section className="pixelsmith-ecwid-search__section">
            <h3>{labels.categories}</h3>
            <div className="pixelsmith-ecwid-search__pills pixelsmith-ecwid-search__pills--categories">
              {jumps.map((category) => (
                <Link key={category.id} href={categoryHref(category)} prefetch={false} onClick={() => onOpenChange(false)}>{category.name}</Link>
              ))}
            </div>
          </section>
        ) : null}
        <button type="button" className="pixelsmith-ecwid-search__clear-active" onClick={clearActive}>{labels.clear}</button>
      </div>
    </div>
  )
}

export interface EcwidMegaMenuProps {
  config: ResolvedEcwidStoreConfig
  categories: readonly EcwidMenuCategory[]
  storeLabel: string
  categoryHref: (category: EcwidMenuCategory) => string
  open: boolean
  onOpenChange: (open: boolean) => void
  className?: string
}

export function EcwidMegaMenu({ config, categories, storeLabel, categoryHref, open, onOpenChange, className = '' }: EcwidMegaMenuProps) {
  return (
    <div className={`pixelsmith-ecwid-megamenu ${className}`.trim()} data-open={open ? 'true' : 'false'}>
      <div className="pixelsmith-ecwid-megamenu__panel">
        <Link href={storeUrl(config)} prefetch={false} onClick={() => onOpenChange(false)} className="pixelsmith-ecwid-megamenu__store-link">{storeLabel}</Link>
        <div className="pixelsmith-ecwid-megamenu__grid">
          {categories.map((category) => (
            <div key={category.id} className="pixelsmith-ecwid-megamenu__group">
              <Link href={categoryHref(category)} prefetch={false} onClick={() => onOpenChange(false)} className="pixelsmith-ecwid-megamenu__heading">{category.name}</Link>
              {category.children.length > 0 ? (
                <ul>
                  {category.children.map((child) => (
                    <li key={child.id}><Link href={categoryHref(child)} prefetch={false} onClick={() => onOpenChange(false)}>{child.name}</Link></li>
                  ))}
                </ul>
              ) : null}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

export interface EcwidCartBridgeProps {
  config: ResolvedEcwidStoreConfig
  onCountChange?: (count: number) => void
}

export function EcwidCartBridge({ config, onCountChange }: EcwidCartBridgeProps) {
  const key = `${config.search.storageNamespace}:cart-count`
  useEffect(() => {
    const update = (cart: { productsQuantity?: number }) => {
      const count = Math.max(0, cart.productsQuantity ?? 0)
      writeStorage(window.localStorage, key, String(count))
      onCountChange?.(count)
    }
    window.Ecwid?.Cart?.get(update)
    window.Ecwid?.OnCartChanged?.add(update)
  }, [key, onCountChange])
  return null
}

export function getCachedEcwidCartCount(config: ResolvedEcwidStoreConfig): number {
  if (typeof window === 'undefined') return 0
  const value = Number(readStorage(window.localStorage, `${config.search.storageNamespace}:cart-count`))
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : 0
}

export function navigateToEcwidCart(config: ResolvedEcwidStoreConfig) {
  window.location.assign(cartUrl(config))
}
