import { countryNameForCode } from '@/lib/membership/countries';

function flagEmoji(countryCode: string): string {
  const code = countryCode.trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(code)) return '';
  return [...code].map((letter) => String.fromCodePoint(127397 + letter.charCodeAt(0))).join('');
}

export function CountryFlag({ code, className = '' }: { code: string; className?: string }) {
  const emoji = flagEmoji(code);
  if (!emoji) return null;
  return (
    <span
      aria-label={countryNameForCode(code)}
      className={`inline-flex size-5 shrink-0 items-center justify-center overflow-hidden rounded-full bg-muted text-[17px] leading-none ${className}`}
      role="img"
      title={countryNameForCode(code)}
    >
      <span className="scale-125">{emoji}</span>
    </span>
  );
}
