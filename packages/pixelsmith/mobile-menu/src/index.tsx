"use client";

import Link from "next/link";
import React, { useId, useState } from "react";

export interface MobileMenuItem
{
  label: string;
  href?: string;
  external?: boolean;
  children?: readonly MobileMenuItem[];
}

export interface MobileMenuProps
{
  items: readonly MobileMenuItem[];
  utility?: React.ReactNode;
  className?: string;
  navLabel?: string;
  menuLabel?: string;
  initiallyOpen?: boolean;
  renderTrigger?: boolean;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  onNavigate?: () => void;
}

function MenuIcon({ open }: { open: boolean }): React.JSX.Element
{
  return (
    <span className="pixelsmith-mobile-menu__icon" aria-hidden="true" data-open={open ? "true" : "false"}>
      <span />
      <span />
      <span />
    </span>
  );
}

function MenuLevel({
  items,
  depth,
  closeMenu,
}: {
  items: readonly MobileMenuItem[];
  depth: number;
  closeMenu: () => void;
}): React.JSX.Element
{
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({});

  return (
    <ul className="pixelsmith-mobile-menu__list" data-depth={depth}>
      {items.map((item, index) => {
        const key = `${depth}-${index}-${item.label}`;
        const hasChildren = Boolean(item.children?.length);
        const groupOpen = Boolean(openGroups[key]);

        return (
          <li key={key} className="pixelsmith-mobile-menu__item" data-depth={depth}>
            <div className="pixelsmith-mobile-menu__row">
              {item.href ? (
                item.external ? (
                  <a
                    href={item.href}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="pixelsmith-mobile-menu__link"
                    onClick={closeMenu}
                  >
                    {item.label}
                  </a>
                ) : (
                  <Link href={item.href} className="pixelsmith-mobile-menu__link" onClick={closeMenu}>
                    {item.label}
                  </Link>
                )
              ) : (
                <button
                  type="button"
                  className="pixelsmith-mobile-menu__link pixelsmith-mobile-menu__link--button"
                  aria-expanded={hasChildren ? groupOpen : undefined}
                  onClick={() => {
                    if (hasChildren)
                      {
                        setOpenGroups((current) => ({ ...current, [key]: !current[key] }));
                      }
                  }}
                >
                  <span>{item.label}</span>
                  {hasChildren && <span className="pixelsmith-mobile-menu__chevron" aria-hidden="true" data-open={groupOpen ? "true" : "false"}>⌄</span>}
                </button>
              )}
              {item.href && hasChildren && (
                <button
                  type="button"
                  className="pixelsmith-mobile-menu__submenu-toggle"
                  aria-label={`Toggle ${item.label}`}
                  aria-expanded={groupOpen}
                  onClick={() => setOpenGroups((current) => ({ ...current, [key]: !current[key] }))}
                >
                  <span className="pixelsmith-mobile-menu__chevron" aria-hidden="true" data-open={groupOpen ? "true" : "false"}>⌄</span>
                </button>
              )}
            </div>
            {hasChildren && groupOpen && item.children && (
              <MenuLevel items={item.children} depth={depth + 1} closeMenu={closeMenu} />
            )}
          </li>
        );
      })}
    </ul>
  );
}

export function MobileMenu({
  items,
  utility,
  className = "",
  navLabel = "Mobile navigation",
  menuLabel = "Menu",
  initiallyOpen = false,
  renderTrigger = true,
  open: controlledOpen,
  onOpenChange,
  onNavigate,
}: MobileMenuProps): React.JSX.Element
{
  const [internalOpen, setInternalOpen] = useState(initiallyOpen);
  const panelId = useId();
  const open = controlledOpen ?? internalOpen;

  function setOpen(next: boolean): void
    {
      if (controlledOpen === undefined)
        {
          setInternalOpen(next);
        }
      onOpenChange?.(next);
    }

  function closeMenu(): void
    {
      setOpen(false);
      onNavigate?.();
    }

  return (
    <div className={`pixelsmith-mobile-menu ${className}`.trim()}>
      {renderTrigger && (
        <button
          type="button"
          className="pixelsmith-mobile-menu__trigger"
          aria-label={menuLabel}
          aria-expanded={open}
          aria-controls={panelId}
          onClick={() => setOpen(!open)}
        >
          <MenuIcon open={open} />
        </button>
      )}
      <div id={panelId} className="pixelsmith-mobile-menu__panel" data-open={open ? "true" : "false"}>
        <nav className="pixelsmith-mobile-menu__nav" aria-label={navLabel}>
          <MenuLevel items={items} depth={0} closeMenu={closeMenu} />
          {utility && <div className="pixelsmith-mobile-menu__utility">{utility}</div>}
        </nav>
      </div>
    </div>
  );
}
