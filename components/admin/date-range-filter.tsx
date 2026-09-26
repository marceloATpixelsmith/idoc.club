'use client';

import { CalendarIcon, XCircle } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { DateRange } from 'react-day-picker';
import { Button } from '@/components/ui/button';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Separator } from '@/components/ui/separator';
import { formatDate } from '@/lib/format';

function toDateKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function fromDateKey(value?: string): Date | undefined {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined;
  const date = new Date(`${value}T00:00:00`);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

/**
 * A DataTableDateFilter lookalike controlled by plain from/to props instead of a tanstack Column,
 * for date ranges the server reads as standalone query params rather than a per-column filter.
 *
 * The chosen range is only committed (via onChange) when the popover closes -- picking a start
 * date alone doesn't narrow the table yet, so the admin can also pick an end date before anything
 * applies, rather than the range appearing to filter on a single day after the first click.
 */
export function DateRangeFilter({
  from, label, onChange, onDraftActiveChange, resetSignal, to,
}: {
  from?: string; label: string; onChange: (from: string | undefined, to: string | undefined) => void;
  /** Reports whether an uncommitted, in-progress selection exists (popover open with a picked date),
   * so a caller can keep its own Reset control available even before this commits on close. */
  onDraftActiveChange?: (active: boolean) => void;
  /** Bump this (e.g. a counter) to force-clear an in-progress draft, such as from a toolbar-level
   * Reset click. Needed because when from/to were already undefined, clearing them via a caller's
   * own Reset doesn't change those prop values, so the from/to resync effect below has nothing to
   * react to and the stale draft would otherwise get committed back on close. */
  resetSignal?: number;
  to?: string;
}) {
  const committed: DateRange = { from: fromDateKey(from), to: fromDateKey(to) };
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<DateRange>(committed);
  const range = open ? draft : committed;
  const hasValue = Boolean(range.from || range.to);
  const draftActive = open && Boolean(draft.from || draft.to);

  // Re-sync whenever the committed from/to props change while the popover is open (e.g. browser
  // back/forward navigating the URL out from under an open popover), not just on open -- otherwise
  // closing would commit the now-stale draft and silently revert that navigation.
  useEffect(() => {
    if (open) setDraft({ from: fromDateKey(from), to: fromDateKey(to) });
  }, [from, to, open]);

  useEffect(() => {
    if (resetSignal !== undefined) {
      setDraft({ from: undefined, to: undefined });
      setOpen(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- fires only when the signal itself changes, not on every render.
  }, [resetSignal]);

  // A toolbar-level Reset button lives outside this popover, so clicking it while the popover is
  // open is itself an "outside" interaction. Radix's outside-dismiss detection runs on pointerdown,
  // which fires before Reset's own onClick -- so without this guard, onOpenChange below would run
  // first and commit the stale draft to the URL, racing Reset's own separate clear navigation that
  // only fires once the later click event reaches it. Skip the auto-dismiss entirely for a click
  // that lands on Reset; the resetSignal effect above already closes the popover deliberately once
  // that click's handler actually runs.
  const onPointerDownOutside: React.ComponentProps<typeof PopoverContent>['onPointerDownOutside'] = (event) => {
    if ((event.target as Element | null)?.closest('[aria-label="Reset filters"]')) event.preventDefault();
  };

  useEffect(() => {
    onDraftActiveChange?.(draftActive);
  }, [draftActive, onDraftActiveChange]);

  function onOpenChange(next: boolean) {
    if (!next && (draft.from?.getTime() !== committed.from?.getTime() || draft.to?.getTime() !== committed.to?.getTime())) {
      onChange(draft.from ? toDateKey(draft.from) : undefined, draft.to ? toDateKey(draft.to) : undefined);
    }
    setOpen(next);
  }

  function onReset(event: React.MouseEvent) {
    event.stopPropagation();
    setDraft({ from: undefined, to: undefined });
    onChange(undefined, undefined);
  }

  const dateText = range.from && range.to && range.from.getTime() !== range.to.getTime()
    ? `${formatDate(range.from)} - ${formatDate(range.to)}`
    : formatDate(range.from ?? range.to);

  return (
    <Popover onOpenChange={onOpenChange} open={open}>
      <PopoverTrigger asChild>
        <Button data-idoc-table-control variant="outline" className="border-dashed font-normal">
          {hasValue ? (
            <div
              aria-label={`Clear ${label} filter`}
              className="rounded-sm opacity-70 transition-opacity hover:opacity-100 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              onClick={onReset}
              role="button"
              tabIndex={0}
            >
              <XCircle />
            </div>
          ) : (
            <CalendarIcon />
          )}
          <span className="flex items-center gap-2">
            <span>{label}</span>
            {hasValue && (
              <>
                <Separator orientation="vertical" className="mx-0.5 data-[orientation=vertical]:h-4" />
                <span>{dateText}</span>
              </>
            )}
          </span>
        </Button>
      </PopoverTrigger>
      <PopoverContent data-idoc-table-panel className="w-auto p-0" align="start" onPointerDownOutside={onPointerDownOutside}>
        <Calendar autoFocus captionLayout="dropdown" mode="range" onSelect={(next) => setDraft(next ?? { from: undefined, to: undefined })} selected={draft} />
      </PopoverContent>
    </Popover>
  );
}
