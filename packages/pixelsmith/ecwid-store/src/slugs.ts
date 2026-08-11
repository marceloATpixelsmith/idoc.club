import type { EcwidCategoryRecord } from './server'

export function ecwidSlugify(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

export function ecwidEntitySlug(name: string, id: number): string {
  const nameSlug = ecwidSlugify(name)
  return `${nameSlug || 'item'}-${id}`
}

export function ecwidEntityIdFromSlug(slug: string): number | null {
  const match = slug.match(/(?:^|-)(\d+)$/)
  if (!match?.[1]) return null
  const id = Number(match[1])
  return Number.isSafeInteger(id) && id > 0 ? id : null
}

export function findEcwidCategoryBySlug(
  categories: readonly EcwidCategoryRecord[],
  slug: string,
  slugForCategory: (category: EcwidCategoryRecord) => string = (category) => ecwidEntitySlug(category.name, category.id),
): EcwidCategoryRecord | null {
  const directId = ecwidEntityIdFromSlug(slug)
  if (directId) {
    const byId = categories.find((category) => category.id === directId)
    if (byId) return byId
  }
  return categories.find((category) => slugForCategory(category) === slug) ?? null
}
