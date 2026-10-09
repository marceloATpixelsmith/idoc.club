export function FeiBadge({ className }: { className?: string }) {
  return (
    <a
      aria-label="Visit FEI Dressage"
      href="https://www.fei.org/dressage"
      rel="noopener noreferrer"
      target="_blank"
    >
      <img alt="FEI" className={`w-auto ${className ?? ''}`} src="/fei-logo-white.svg" />
    </a>
  );
}
