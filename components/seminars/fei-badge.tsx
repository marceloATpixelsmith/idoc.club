export function FeiBadge({ className }: { className?: string }) {
  return (
    <a
      aria-label="Visit FEI Dressage"
      href="https://www.fei.org/dressage"
      rel="noopener noreferrer"
      target="_blank"
      className="inline-flex min-h-11 min-w-11 items-center justify-center px-2 py-3"
    >
      <img alt="FEI" className={`w-auto ${className ?? ''}`} width={568} height={89} src="/fei-logo-white.svg" />
    </a>
  );
}
