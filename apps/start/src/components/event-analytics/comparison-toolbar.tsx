import { Button } from '@/components/ui/button';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { cn } from '@/utils/cn';
import { ArrowLeftRight, ChartPie, GitCompareArrows, Plus, Undo2, X } from 'lucide-react';
import { useState } from 'react';

import {
  addPeriod,
  type ComparisonState,
  comparisonPeriodChips,
  removePeriod,
  startComparison,
  swapPeriods,
} from './comparison-state';

/**
 * The comparison control and, once it is on, the period chips (design 3a/3b).
 *
 * Every transition comes from `comparison-state.ts`; this file only renders.
 */

type Props = {
  state: ComparisonState;
  onChange: (next: ComparisonState) => void;
  onCancel: () => void;
  /** First day of the baseline period. */
  anchorStart: Date;
  periodDays: number;
};

const PREVIOUS_COUNTS = [1, 2, 3];

export function ComparisonButton({
  state,
  onChange,
}: Pick<Props, 'state' | 'onChange'>) {
  const [open, setOpen] = useState(false);
  const [previousCount, setPreviousCount] = useState(
    Math.max(1, state.compareCount - 1),
  );

  const apply = (count: number) => {
    onChange(startComparison(state, count));
    setOpen(false);
  };

  return (
    <Popover onOpenChange={setOpen} open={open}>
      <PopoverTrigger asChild>
        <Button
          icon={GitCompareArrows}
          variant={open || state.compare ? 'default' : 'outline'}
        >
          Comparison
        </Button>
      </PopoverTrigger>

      <PopoverContent align="start" className="w-[330px] p-2">
        <button
          className="col w-full gap-1 rounded-md p-2.5 text-left hover:bg-def-100"
          onClick={() => apply(previousCount)}
          type="button"
        >
          <span className="row items-center gap-2 text-[13px] font-medium">
            <Undo2 className="size-[15px]" />
            With previous period
          </span>
          <span className="text-[12px] leading-relaxed text-muted-foreground">
            Compare your metrics with the previous period of equal length for
            shared segments
          </span>
          <span className="mt-2 text-[11px] font-medium text-muted-foreground">
            How many previous periods
          </span>
          <span className="row mt-1 gap-1.5">
            {PREVIOUS_COUNTS.map((count) => (
              <button
                className={cn(
                  'h-6 rounded-full border px-2.5 text-[11px] font-medium',
                  count === previousCount
                    ? 'border-foreground bg-foreground text-background'
                    : 'text-muted-foreground',
                )}
                key={count}
                onClick={(event) => {
                  event.stopPropagation();
                  setPreviousCount(count);
                }}
                type="button"
              >
                {count} previous
              </button>
            ))}
          </span>
          <span className="mt-1.5 text-[11px] text-muted-foreground">
            Up to 3 previous periods — 4 columns per metric
          </span>
        </button>

        {/* Segment comparison is a later phase. The design keeps the row, with
            its submenu arrow, rather than hiding what is coming. */}
        <div
          className="row cursor-not-allowed gap-2 rounded-md p-2.5 opacity-50"
          title="Segment comparison is not available yet"
        >
          <ChartPie className="mt-px size-[15px] shrink-0" />
          <div className="col min-w-0 flex-1 gap-1">
            <span className="row items-center gap-1.5">
              <span className="text-[13px] font-medium">
                With existing or new segment
              </span>
              <span className="rounded-full bg-def-200 px-1.5 py-0.5 text-[10px] font-semibold">
                SOON
              </span>
            </span>
            <span className="text-[12px] leading-relaxed text-muted-foreground">
              Select existing segments from the list or create new ones. You can
              specify the same period or choose different dates.
            </span>
          </div>
          <span aria-hidden className="self-center text-muted-foreground">
            ›
          </span>
        </div>
      </PopoverContent>
    </Popover>
  );
}

export function ComparisonPeriodBar({
  state,
  onChange,
  onCancel,
  anchorStart,
  periodDays,
}: Props) {
  if (!state.compare) {
    return null;
  }

  const chips = comparisonPeriodChips(state, anchorStart, periodDays);

  return (
    <div className="row flex-wrap items-center gap-1.5">
      {chips.map((chip) => (
        <div
          className="row h-8 items-center gap-1.5 rounded-md border px-2 text-[13px] font-medium shadow-sm"
          key={chip.letter}
        >
          <span
            className={cn(
              'row size-[17px] items-center justify-center rounded-full font-mono text-[10px] font-semibold',
              chip.index === 0
                ? 'bg-highlight/10 text-highlight'
                : 'bg-def-100',
            )}
          >
            {chip.letter}
          </span>
          {chip.range}
          <span className="font-mono text-[10px] text-muted-foreground">
            {chip.mark}
          </span>
          {chip.removable && (
            <button
              aria-label={`Remove period ${chip.letter}`}
              className="row size-[18px] items-center justify-center rounded text-muted-foreground hover:bg-def-200"
              onClick={() => onChange(removePeriod(state))}
              title="Remove this period"
              type="button"
            >
              <X className="size-3" />
            </button>
          )}
        </div>
      ))}

      {state.compareCount < 4 && (
        <button
          className="row h-8 items-center gap-1.5 rounded-md border border-dashed px-2.5 text-[13px] text-highlight"
          onClick={() => onChange(addPeriod(state))}
          type="button"
        >
          <Plus className="size-3.5" />
          Add previous period
        </button>
      )}

      <span className="text-[11px] text-muted-foreground">
        {state.compareCount} periods · max 4
      </span>

      <button
        aria-label="Reverse period order"
        className="row size-8 items-center justify-center rounded-md border"
        onClick={() => onChange(swapPeriods(state))}
        title="Reverse period order"
        type="button"
      >
        <ArrowLeftRight className="size-[15px]" />
      </button>

      {/* Placeholder until segment comparison ships; the design keeps it here. */}
      <div className="row h-8 items-center gap-1.5 rounded-md border px-2.5 text-[13px] text-muted-foreground">
        <ChartPie className="size-[15px]" />
        Segment · <span className="text-foreground">Not selected</span>
      </div>

      <div className="flex-1" />

      <button
        className="row h-8 items-center gap-1.5 rounded-md border px-2.5 text-[13px] font-medium shadow-sm"
        onClick={onCancel}
        type="button"
      >
        <X className="size-3.5" />
        Cancel comparison
      </button>
    </div>
  );
}
