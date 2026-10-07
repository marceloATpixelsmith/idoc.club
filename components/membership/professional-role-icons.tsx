import type { SVGProps } from 'react';

type ProfessionalRoleIconProps = SVGProps<SVGSVGElement> & { 'data-icon-tooltip'?: string };

export function HorseshoeIcon(props: ProfessionalRoleIconProps) {
  return (
    <svg
      data-icon-tooltip={props['data-icon-tooltip'] ?? 'Steward'}
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.8"
      viewBox="0 0 24 24"
      {...props}
    >
      <path d="M5 3v8a7 7 0 0 0 14 0V3h-4v8a3 3 0 0 1-6 0V3H5Z" />
      <circle cx="7" cy="6" fill="currentColor" r="0.7" stroke="none" />
      <circle cx="7" cy="10" fill="currentColor" r="0.7" stroke="none" />
      <circle cx="17" cy="6" fill="currentColor" r="0.7" stroke="none" />
      <circle cx="17" cy="10" fill="currentColor" r="0.7" stroke="none" />
      <circle cx="9" cy="16.5" fill="currentColor" r="0.7" stroke="none" />
      <circle cx="15" cy="16.5" fill="currentColor" r="0.7" stroke="none" />
    </svg>
  );
}
