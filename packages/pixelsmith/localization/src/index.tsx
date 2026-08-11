"use client";

import React, {
  createContext,
  type PropsWithChildren,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";

export type LocaleCode = string;

export interface LocaleDefinition
{
  code: LocaleCode;
  label: string;
  shortLabel?: string;
  htmlLang?: string;
  commerceLocale?: string;
}

export interface LocalizationConfig
{
  locales: readonly LocaleDefinition[];
  defaultLocale: LocaleCode;
  cookieName?: string;
  cookieMaxAge?: number;
  detectBrowserLanguage?: boolean;
}

export type Localized<T = string> = Record<string, T>;

export function pick<T>(value: Localized<T>, locale: LocaleCode): T
{
  if (!(locale in value))
    {
      throw new Error(`Missing localized value for locale ${locale}.`);
    }

  return value[locale] as T;
}

export function normalizeLocale(value: string | null | undefined, config: LocalizationConfig): LocaleCode
{
  if (!value)
    {
      return config.defaultLocale;
    }

  const lower = value.toLowerCase();
  const exact = config.locales.find((locale) => locale.code.toLowerCase() === lower);
  if (exact)
    {
      return exact.code;
    }

  const base = lower.split("-")[0];
  const baseMatch = config.locales.find((locale) => locale.code.toLowerCase().split("-")[0] === base);
  return baseMatch?.code ?? config.defaultLocale;
}

export function getCommerceLocale(locale: LocaleCode, config: LocalizationConfig): string
{
  const definition = config.locales.find((item) => item.code === locale);
  return definition?.commerceLocale ?? definition?.htmlLang ?? definition?.code ?? locale;
}

interface LanguageContextValue
{
  lang: LocaleCode;
  setLang: (locale: LocaleCode) => void;
  resolved: boolean;
  config: LocalizationConfig;
}

const LanguageContext = createContext<LanguageContextValue | null>(null);

function readCookie(name: string): string | undefined
{
  if (typeof document === "undefined")
    {
      return undefined;
    }

  const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = document.cookie.match(new RegExp(`(?:^|; )${escapedName}=([^;]*)`));
  return match?.[1] ? decodeURIComponent(match[1]) : undefined;
}

function writeCookie(name: string, value: string, maxAge: number): void
{
  document.cookie = `${name}=${encodeURIComponent(value)};path=/;max-age=${maxAge};samesite=lax`;
}

export function LanguageProvider({
  children,
  config,
}: PropsWithChildren<{ config: LocalizationConfig }>): React.JSX.Element
{
  const [lang, setLangState] = useState(config.defaultLocale);
  const [resolved, setResolved] = useState(false);
  const cookieName = config.cookieName ?? "site_lang";
  const cookieMaxAge = config.cookieMaxAge ?? 31_536_000;

  useEffect(() => {
    const saved = readCookie(cookieName);
    const detected = saved
      ? normalizeLocale(saved, config)
      : config.detectBrowserLanguage === false
        ? config.defaultLocale
        : normalizeLocale(typeof navigator !== "undefined" ? navigator.language : undefined, config);

    setLangState(detected);
    writeCookie(cookieName, detected, cookieMaxAge);
    setResolved(true);
  }, [config, cookieName, cookieMaxAge]);

  useEffect(() => {
    const definition = config.locales.find((locale) => locale.code === lang);
    document.documentElement.lang = definition?.htmlLang ?? lang;
  }, [lang, config.locales]);

  const setLang = useCallback((nextLocale: LocaleCode) => {
    if (!config.locales.some((locale) => locale.code === nextLocale))
      {
        throw new Error(`Unsupported locale ${nextLocale}.`);
      }

    setLangState(nextLocale);
    writeCookie(cookieName, nextLocale, cookieMaxAge);
  }, [config.locales, cookieName, cookieMaxAge]);

  const value = useMemo<LanguageContextValue>(() => ({ lang, setLang, resolved, config }), [lang, setLang, resolved, config]);
  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
}

export function useLanguage(): LanguageContextValue
{
  const context = useContext(LanguageContext);
  if (!context)
    {
      throw new Error("useLanguage must be used within LanguageProvider.");
    }
  return context;
}

export interface LanguageToggleProps
{
  className?: string;
  direction?: "down" | "right";
  variant?: "dark" | "light";
  textTone?: "inherit" | "dark" | "light";
  ariaLabel?: string;
  reloadOnChange?: boolean;
  onChange?: (locale: LocaleCode) => void;
}

export function LanguageToggle({
  className = "",
  direction = "down",
  variant = "dark",
  textTone = "inherit",
  ariaLabel = "Language",
  reloadOnChange = false,
  onChange,
}: LanguageToggleProps): React.JSX.Element | null
{
  const { lang, setLang, resolved, config } = useLanguage();
  const current = config.locales.find((locale) => locale.code === lang);
  const alternate = config.locales.find((locale) => locale.code !== lang);

  if (!resolved || !current || !alternate)
    {
      return null;
    }

  function selectLanguage(code: LocaleCode): void
    {
      if (code === lang)
        {
          return;
        }

      setLang(code);
      onChange?.(code);

      if (reloadOnChange)
        {
          window.location.reload();
        }
    }

  return (
    <div
      className={`pixelsmith-language-toggle pixelsmith-language-toggle--${variant} pixelsmith-language-toggle--text-${textTone} ${className}`.trim()}
      data-direction={direction}
      role="group"
      aria-label={ariaLabel}
    >
      <button type="button" className="pixelsmith-language-toggle__current" aria-haspopup="true" aria-label={`${ariaLabel}: ${current.label}`}>
        {current.shortLabel ?? current.code}
      </button>
      <div className="pixelsmith-language-toggle__flyout">
        <div className="pixelsmith-language-toggle__bubble">
          <button type="button" className="pixelsmith-language-toggle__alternate" onClick={() => selectLanguage(alternate.code)} aria-label={`${ariaLabel}: ${alternate.label}`}>
            {alternate.shortLabel ?? alternate.code}
          </button>
        </div>
      </div>
    </div>
  );
}
