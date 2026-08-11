import { createHmac, timingSafeEqual } from 'node:crypto'
import type { ResolvedEcwidStoreConfig } from './config'

const ECWID_API_BASE = 'https://app.ecwid.com/api/v3'

export interface EcwidCategoryRecord {
  id: number
  parentId?: number
  name: string
  nameTranslated?: Record<string, string>
  description?: string
  enabled?: boolean
  orderBy?: number
  productCount?: number
  [key: string]: unknown
}

export interface EcwidProductSummary {
  id?: number
  categoryIds?: number[]
  name?: string
  nameTranslated?: Record<string, string>
  [key: string]: unknown
}

export interface EcwidMenuCategory {
  id: number
  parentId?: number
  name: string
  translatedNames: Record<string, string>
  description?: string
  children: EcwidMenuCategory[]
  source: EcwidCategoryRecord
}

export interface EcwidApiOptions {
  apiKey?: string
  fetchImpl?: typeof fetch
  timeoutMs?: number
}

export interface EcwidMenuOptions extends EcwidApiOptions {
  locale?: string
  excludedCategoryIds?: readonly number[]
  sort?: (a: EcwidMenuCategory, b: EcwidMenuCategory) => number
}

function getApiKey(override?: string): string {
  const key = override ?? process.env.ECWID_API_KEY
  if (!key) throw new Error('Missing required ECWID_API_KEY environment variable.')
  return key
}

function getClientSecret(override?: string): string {
  const secret = override ?? process.env.ECWID_CLIENT_SECRET
  if (!secret) throw new Error('Missing required ECWID_CLIENT_SECRET environment variable.')
  return secret
}

async function ecwidFetch<T>(
  config: ResolvedEcwidStoreConfig,
  path: string,
  options: EcwidApiOptions = {},
): Promise<T> {
  const fetchImpl = options.fetchImpl ?? fetch
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? 15_000)

  try {
    const response = await fetchImpl(`${ECWID_API_BASE}/${config.storeId}/${path}`, {
      headers: { Authorization: `Bearer ${getApiKey(options.apiKey)}` },
      signal: controller.signal,
    })
    if (!response.ok) throw new Error(`Ecwid API request failed with HTTP ${response.status}.`)
    return await response.json() as T
  } finally {
    clearTimeout(timeout)
  }
}

export async function fetchEcwidCategories(
  config: ResolvedEcwidStoreConfig,
  options: EcwidApiOptions = {},
): Promise<EcwidCategoryRecord[]> {
  const items: EcwidCategoryRecord[] = []
  let offset = 0
  const limit = 100

  while (true) {
    const params = new URLSearchParams({ limit: String(limit), offset: String(offset) })
    const page = await ecwidFetch<{ items?: EcwidCategoryRecord[]; total?: number }>(
      config,
      `categories?${params}`,
      options,
    )
    const pageItems = page.items ?? []
    items.push(...pageItems)
    offset += pageItems.length
    if (pageItems.length < limit || (page.total !== undefined && offset >= page.total)) break
  }

  return items
}

export async function fetchEnabledEcwidProducts(
  config: ResolvedEcwidStoreConfig,
  options: EcwidApiOptions = {},
): Promise<EcwidProductSummary[]> {
  const items: EcwidProductSummary[] = []
  let offset = 0
  const limit = 100

  while (true) {
    const params = new URLSearchParams({
      enabled: 'true',
      limit: String(limit),
      offset: String(offset),
      responseFields: 'items(id,categoryIds)',
    })
    const page = await ecwidFetch<{ items?: EcwidProductSummary[]; total?: number }>(
      config,
      `products?${params}`,
      options,
    )
    const pageItems = page.items ?? []
    items.push(...pageItems)
    offset += pageItems.length
    if (pageItems.length < limit || (page.total !== undefined && offset >= page.total)) break
  }

  return items
}

export async function fetchEcwidProductById<T = Record<string, unknown>>(
  config: ResolvedEcwidStoreConfig,
  productId: number,
  options: EcwidApiOptions = {},
): Promise<T> {
  return ecwidFetch<T>(config, `products/${productId}`, options)
}

export async function fetchEcwidProductsForSitemap<T extends Record<string, unknown> = Record<string, unknown>>(
  config: ResolvedEcwidStoreConfig,
  options: EcwidApiOptions = {},
): Promise<T[]> {
  const items: T[] = []
  let offset = 0
  const limit = 100

  while (true) {
    const params = new URLSearchParams({ enabled: 'true', limit: String(limit), offset: String(offset) })
    const page = await ecwidFetch<{ items?: T[]; total?: number }>(config, `products?${params}`, options)
    const pageItems = page.items ?? []
    items.push(...pageItems)
    offset += pageItems.length
    if (pageItems.length < limit || (page.total !== undefined && offset >= page.total)) break
  }
  return items
}

function localizedCategoryName(category: EcwidCategoryRecord, locale?: string): string {
  if (!locale) return category.name
  return category.nameTranslated?.[locale] || category.name
}

export async function fetchEcwidMenuCategories(
  config: ResolvedEcwidStoreConfig,
  options: EcwidMenuOptions = {},
): Promise<EcwidMenuCategory[]> {
  const [categories, products] = await Promise.all([
    fetchEcwidCategories(config, options),
    fetchEnabledEcwidProducts(config, options),
  ])
  const excluded = new Set([...(config.excludedCategoryIds ?? []), ...(options.excludedCategoryIds ?? [])])
  const byId = new Map(categories.map((category) => [category.id, category]))
  const eligible = new Set<number>()

  for (const product of products) {
    for (const categoryId of product.categoryIds ?? []) eligible.add(categoryId)
  }

  for (const categoryId of [...eligible]) {
    let current = byId.get(categoryId)
    const visited = new Set<number>()
    while (current?.parentId && !visited.has(current.parentId)) {
      visited.add(current.parentId)
      eligible.add(current.parentId)
      current = byId.get(current.parentId)
    }
  }

  const nodes = new Map<number, EcwidMenuCategory>()
  for (const category of categories) {
    if (category.enabled === false || excluded.has(category.id) || !eligible.has(category.id)) continue
    nodes.set(category.id, {
      id: category.id,
      parentId: category.parentId,
      name: localizedCategoryName(category, options.locale),
      translatedNames: category.nameTranslated ?? {},
      description: category.description,
      children: [],
      source: category,
    })
  }

  const roots: EcwidMenuCategory[] = []
  for (const node of nodes.values()) {
    const parent = node.parentId ? nodes.get(node.parentId) : undefined
    if (parent) parent.children.push(node)
    else roots.push(node)
  }

  const sorter = options.sort ?? ((a: EcwidMenuCategory, b: EcwidMenuCategory) => {
    const orderA = typeof a.source.orderBy === 'number' ? a.source.orderBy : Number.MAX_SAFE_INTEGER
    const orderB = typeof b.source.orderBy === 'number' ? b.source.orderBy : Number.MAX_SAFE_INTEGER
    return orderA - orderB || a.name.localeCompare(b.name)
  })
  const sortTree = (items: EcwidMenuCategory[]) => {
    items.sort(sorter)
    for (const item of items) sortTree(item.children)
  }
  sortTree(roots)
  return roots
}

export interface EcwidWebhookEnvelope {
  eventId: string
  eventCreated: string | number
  storeId?: number
  entityId?: number
  eventType?: string
  [key: string]: unknown
}

export function verifyEcwidWebhookSignature(
  signature: string | null,
  event: EcwidWebhookEnvelope,
  clientSecret?: string,
): boolean {
  if (!signature || !event.eventId || event.eventCreated === undefined) return false
  const expected = createHmac('sha256', getClientSecret(clientSecret))
    .update(`${event.eventCreated}.${event.eventId}`)
    .digest('base64')
  const actualBuffer = Buffer.from(signature)
  const expectedBuffer = Buffer.from(expected)
  return actualBuffer.length === expectedBuffer.length && timingSafeEqual(actualBuffer, expectedBuffer)
}

export async function readAndVerifyEcwidWebhook(
  request: Request,
  config: ResolvedEcwidStoreConfig,
  clientSecret?: string,
): Promise<EcwidWebhookEnvelope> {
  const event = await request.json() as EcwidWebhookEnvelope
  if (event.storeId !== undefined && event.storeId !== config.storeId) throw new Error('Ecwid webhook store ID mismatch.')
  if (!verifyEcwidWebhookSignature(request.headers.get('x-ecwid-webhook-signature'), event, clientSecret)) {
    throw new Error('Invalid Ecwid webhook signature.')
  }
  return event
}

export function isEcwidCatalogEvent(eventType?: string): boolean {
  if (!eventType) return false
  return eventType.startsWith('category.') || eventType.startsWith('product.')
}
