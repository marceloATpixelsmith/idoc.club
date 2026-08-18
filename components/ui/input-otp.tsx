'use client';

import { OTPInput, OTPInputContext } from 'input-otp';
import { type ComponentProps, useContext } from 'react';
import { cn } from '@/lib/utils';

export function InputOTP({ className, containerClassName, ...props }: ComponentProps<typeof OTPInput> & { containerClassName?: string }) {
  return (
    <OTPInput
      className={cn('disabled:cursor-not-allowed', className)}
      containerClassName={cn('flex items-center gap-2', containerClassName)}
      {...props}
    />
  );
}

export function InputOTPGroup({ className, ...props }: ComponentProps<'div'>) {
  return <div className={cn('flex items-center gap-2', className)} {...props} />;
}

export function InputOTPSlot({ className, index, ...props }: ComponentProps<'div'> & { index: number }) {
  const inputOTPContext = useContext(OTPInputContext);
  const slot = inputOTPContext?.slots[index];
  const char = slot?.char;
  const hasFakeCaret = slot?.hasFakeCaret;
  const isActive = slot?.isActive;
  return (
    <div
      className={cn(
        'relative flex h-12 w-12 items-center justify-center rounded-lg border border-gray-300 text-lg font-medium text-gray-900 transition-colors',
        isActive && 'z-10 border-gray-900 ring-2 ring-gray-900/10',
        className,
      )}
      {...props}
    >
      {char}
      {hasFakeCaret ? (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <div className="h-5 w-px animate-pulse bg-gray-900" />
        </div>
      ) : null}
    </div>
  );
}
