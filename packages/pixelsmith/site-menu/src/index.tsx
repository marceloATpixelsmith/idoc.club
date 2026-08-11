'use client'

import Link from 'next/link'
import { Fragment, useEffect, useId, useState, type ReactNode } from 'react'
import { usePathname } from 'next/navigation'

export interface SiteMenuItem {
  label: string
  href: string
  external?: boolean
  exact?: boolean
  id?: string
}

export interface SiteMenuStateContext {
  pathname: string
  scrolled: boolean
  open: boolean
  mounted: boolean
  elevated: boolean
}

export type SiteMenuSlot = ReactNode | ((context: SiteMenuStateContext) => ReactNode)

export interface SiteMenuItemRenderContext {
  active: boolean
  pathname: string
  closeMenu: () => void
  desktopLinkClassName: string
  mobileLinkClassName: string
  menu: SiteMenuStateContext
}

export interface SiteMenuProps {
  items: readonly SiteMenuItem[]
  brand: SiteMenuSlot
  utility?: SiteMenuSlot
  mobileHeaderUtility?: SiteMenuSlot
  mobileUtility?: SiteMenuSlot
  mobileExtra?: SiteMenuSlot
  desktopOverlay?: SiteMenuSlot
  className?: string
  homeHref?: string
  brandLabel?: string
  navLabel?: string
  menuLabel?: string
  closeLabel?: string
  scrollThreshold?: number
  pathname?: string
  onNavigate?: () => void
  renderDesktopItem?: (item: SiteMenuItem, context: SiteMenuItemRenderContext) => ReactNode | undefined
  renderMobileItem?: (item: SiteMenuItem, context: SiteMenuItemRenderContext) => ReactNode | undefined
}

function isActive(item: SiteMenuItem, pathname: string): boolean {
  if (item.exact || item.href === '/') return pathname === item.href
  return pathname === item.href || pathname.startsWith(`${item.href}/`)
}

function itemKey(item: SiteMenuItem): string {
  return item.id ?? `${item.href}-${item.label}`
}

function resolveSlot(slot: SiteMenuSlot | undefined, context: SiteMenuStateContext): ReactNode {
  return typeof slot === 'function' ? slot(context) : slot
}

function MenuGlyph({ open }: { open: boolean }) {
  return (
    <span className="pixelsmith-site-menu__glyph" data-open={open ? 'true' : 'false'} aria-hidden="true">
      <span />
      <span />
      <span />
    </span>
  )
}

function DefaultDesktopItem({ item, active, onNavigate }: { item: SiteMenuItem; active: boolean; onNavigate: () => void }) {
  const className = 'pixelsmith-site-menu__desktop-link'
  const content = (
    <>
      <span>{item.label}</span>
      <span className="pixelsmith-site-menu__underline" aria-hidden="true" />
    </>
  )

  return item.external ? (
    <a
      href={item.href}
      target="_blank"
      rel="noopener noreferrer"
      className={className}
      data-active={active ? 'true' : 'false'}
      onClick={onNavigate}
    >
      {content}
    </a>
  ) : (
    <Link href={item.href} className={className} data-active={active ? 'true' : 'false'} onClick={onNavigate}>
      {content}
    </Link>
  )
}

function DefaultMobileItem({ item, active, onNavigate }: { item: SiteMenuItem; active: boolean; onNavigate: () => void }) {
  const className = 'pixelsmith-site-menu__mobile-link'
  return item.external ? (
    <a
      href={item.href}
      target="_blank"
      rel="noopener noreferrer"
      className={className}
      data-active={active ? 'true' : 'false'}
      onClick={onNavigate}
    >
      {item.label}
    </a>
  ) : (
    <Link href={item.href} className={className} data-active={active ? 'true' : 'false'} onClick={onNavigate}>
      {item.label}
    </Link>
  )
}

export function SiteMenu({
  items,
  brand,
  utility,
  mobileHeaderUtility,
  mobileUtility,
  mobileExtra,
  desktopOverlay,
  className = '',
  homeHref = '/',
  brandLabel = 'Home',
  navLabel = 'Primary navigation',
  menuLabel = 'Open menu',
  closeLabel = 'Close menu',
  scrollThreshold = 24,
  pathname: providedPathname,
  onNavigate,
  renderDesktopItem,
  renderMobileItem,
}: SiteMenuProps) {
  const routerPathname = usePathname()
  const pathname = providedPathname ?? routerPathname
  const [open, setOpen] = useState(false)
  const [scrolled, setScrolled] = useState(false)
  const [mounted, setMounted] = useState(false)
  const panelId = useId()

  useEffect(() => {
    setMounted(true)
    const handleScroll = () => setScrolled(window.scrollY > scrollThreshold)
    handleScroll()
    window.addEventListener('scroll', handleScroll, { passive: true })
    return () => window.removeEventListener('scroll', handleScroll)
  }, [scrollThreshold])

  useEffect(() => {
    setOpen(false)
  }, [pathname])

  function handleNavigate() {
    setOpen(false)
    onNavigate?.()
  }

  const menuContext: SiteMenuStateContext = {
    pathname,
    scrolled,
    open,
    mounted,
    elevated: scrolled || open,
  }

  const renderContext = (item: SiteMenuItem): SiteMenuItemRenderContext => ({
    active: isActive(item, pathname),
    pathname,
    closeMenu: handleNavigate,
    desktopLinkClassName: 'pixelsmith-site-menu__desktop-link',
    mobileLinkClassName: 'pixelsmith-site-menu__mobile-link',
    menu: menuContext,
  })

  return (
    <header
      className={`pixelsmith-site-menu ${className}`.trim()}
      data-scrolled={scrolled ? 'true' : 'false'}
      data-open={open ? 'true' : 'false'}
      data-mounted={mounted ? 'true' : 'false'}
      data-elevated={menuContext.elevated ? 'true' : 'false'}
    >
      <div className="pixelsmith-site-menu__bar">
        <Link href={homeHref} className="pixelsmith-site-menu__brand" aria-label={brandLabel} onClick={handleNavigate}>
          {resolveSlot(brand, menuContext)}
        </Link>

        <div className="pixelsmith-site-menu__desktop">
          <nav className="pixelsmith-site-menu__desktop-nav" aria-label={navLabel}>
            {items.map((item) => {
              const context = renderContext(item)
              const custom = renderDesktopItem?.(item, context)
              return (
                <Fragment key={itemKey(item)}>
                  {custom !== undefined
                    ? custom
                    : <DefaultDesktopItem item={item} active={context.active} onNavigate={handleNavigate} />}
                </Fragment>
              )
            })}
          </nav>
          {utility ? <div className="pixelsmith-site-menu__utility">{resolveSlot(utility, menuContext)}</div> : null}
        </div>

        <div className="pixelsmith-site-menu__mobile-controls">
          {mobileHeaderUtility ? (
            <div className="pixelsmith-site-menu__mobile-header-utility">{resolveSlot(mobileHeaderUtility, menuContext)}</div>
          ) : null}
          <button
            type="button"
            className="pixelsmith-site-menu__trigger"
            aria-label={open ? closeLabel : menuLabel}
            aria-expanded={open}
            aria-controls={panelId}
            onClick={() => setOpen((current) => !current)}
          >
            <MenuGlyph open={open} />
          </button>
        </div>
      </div>

      {desktopOverlay ? <div className="pixelsmith-site-menu__desktop-overlay">{resolveSlot(desktopOverlay, menuContext)}</div> : null}

      <div id={panelId} className="pixelsmith-site-menu__mobile-panel" data-open={open ? 'true' : 'false'}>
        <nav className="pixelsmith-site-menu__mobile-nav" aria-label={navLabel}>
          {items.map((item) => {
            const context = renderContext(item)
            const custom = renderMobileItem?.(item, context)
            return (
              <Fragment key={itemKey(item)}>
                {custom !== undefined
                  ? custom
                  : <DefaultMobileItem item={item} active={context.active} onNavigate={handleNavigate} />}
              </Fragment>
            )
          })}
          {mobileExtra ? <div className="pixelsmith-site-menu__mobile-extra">{resolveSlot(mobileExtra, menuContext)}</div> : null}
          {mobileUtility ? <div className="pixelsmith-site-menu__mobile-utility">{resolveSlot(mobileUtility, menuContext)}</div> : null}
        </nav>
      </div>
    </header>
  )
}
