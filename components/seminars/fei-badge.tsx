/** The FEI logo, shown wherever a seminar is flagged `is_fei` -- small and non-interactive, so it
 * never intercepts a click meant for the card or overlay link it sits on top of. */
export function FeiBadge({ className }: { className?: string }) {
  return <img alt="FEI" className={`pointer-events-none w-auto ${className ?? ''}`} src="/fei-logo-white.svg" />;
}
