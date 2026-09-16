import { PureFilterItem } from '@/components/report/sidebar/filters/FilterItem';
import { PropertiesCombobox } from '@/components/report/sidebar/PropertiesCombobox';
import { Button } from '@/components/ui/button';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { cn } from '@/utils/cn';
import type { IFilterGroup } from '@openpanel/validation';
import { FilterIcon } from 'lucide-react';
import { useEffect, useState } from 'react';

import {
  addCondition,
  addSubGroup,
  canAddSubGroup,
  chipsFor,
  emptyGroup,
  flattenGroups,
  isApplyDisabled,
  removeCondition,
  setGroupOp,
  updateCondition,
} from './advanced-filters-state';

/**
 * The "Advanced filters" panel from the design's artboard 1c: a popover holding
 * a root AND/OR group plus at most one level of sub-groups.
 *
 * Edits are staged. The report re-queries on "Apply filters", not on every
 * keystroke in a value field. The chips below the toolbar act on the applied
 * group and remove immediately — they have no Apply of their own.
 *
 * The property picker deliberately offers no profile category: event analytics
 * queries have no profile CTE join, so a `profile.properties.*` condition is
 * dropped when the SQL is built, which would silently widen an OR group.
 */
const PANEL_CATEGORIES = ['event', 'group', 'cohort'] as const;

type Props = {
  /** The applied group. */
  value: IFilterGroup | null;
  onChange: (next: IFilterGroup | null) => void;
};

function OpToggle({
  op,
  onChange,
  className,
}: {
  op: 'and' | 'or';
  onChange: (next: 'and' | 'or') => void;
  className?: string;
}) {
  return (
    <div className={cn('row h-[26px] overflow-hidden rounded border', className)}>
      {(['and', 'or'] as const).map((candidate) => (
        <button
          key={candidate}
          type="button"
          onClick={() => onChange(candidate)}
          className={cn(
            'px-2.5 text-xs font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-highlight',
            candidate === 'or' && 'border-l',
            op === candidate
              ? 'bg-foreground text-background'
              : 'bg-background text-muted-foreground',
          )}
        >
          {candidate.toUpperCase()}
        </button>
      ))}
    </div>
  );
}

export function AdvancedFiltersPanel({ value, onChange }: Props) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<IFilterGroup>(value ?? emptyGroup());

  // Opening the panel starts a fresh staged edit from whatever is applied, so
  // closing without applying discards the draft rather than leaking it.
  useEffect(() => {
    if (open) {
      setDraft(value ?? emptyGroup());
    }
  }, [open, value]);

  const cards = flattenGroups(draft);
  const applyDisabled = isApplyDisabled(draft);
  const chips = value ? chipsFor(value) : [];

  return (
    <div className="col gap-2">
      <Popover onOpenChange={setOpen} open={open}>
        <PopoverTrigger asChild>
          <Button icon={FilterIcon} variant={open ? 'default' : 'outline'}>
            Filters
            {chips.length > 0 && (
              <span className="ml-1.5 min-w-[17px] rounded-full bg-highlight px-1.5 font-mono text-[10px] text-background">
                {chips.length}
              </span>
            )}
          </Button>
        </PopoverTrigger>

        <PopoverContent align="end" className="w-[600px] p-0">
          <div className="row items-center gap-2.5 border-b p-3">
            <span className="flex-1 text-sm font-semibold">
              Advanced filters
            </span>
            <span className="text-xs text-muted-foreground">Match</span>
            <OpToggle
              op={draft.op}
              onChange={(op) => setDraft(setGroupOp(draft, null, op))}
            />
          </div>

          <div className="col max-h-[420px] gap-3 overflow-auto p-3.5">
            {cards.map((card) => (
              <div
                key={card.id ?? 'root'}
                className={cn(
                  'rounded-lg border p-3',
                  card.level === 2 && 'bg-def-100',
                )}
                style={{ marginLeft: card.indent }}
              >
                <div className="row mb-2.5 items-center gap-2">
                  <span className="rounded-full bg-def-200 px-2 py-0.5 text-[10px] font-semibold tracking-wide">
                    {card.scope}
                  </span>
                  <span className="flex-1 text-xs text-muted-foreground">
                    {card.hint}
                  </span>
                  <span className="font-mono text-[10px] text-muted-foreground">
                    LEVEL {card.level}
                  </span>
                </div>

                {card.rows.map((row) => (
                  <div className="row mb-2 items-center gap-1.5" key={row.id}>
                    {/* The join word is the group-operator control: the design
                        shows no per-group toggle, so clicking it flips the
                        operator rather than adding chrome the design lacks. */}
                    <button
                      className="w-[34px] shrink-0 text-right font-mono text-[10px] text-muted-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-highlight"
                      disabled={row.join === ''}
                      onClick={() =>
                        setDraft(
                          setGroupOp(
                            draft,
                            card.id,
                            card.op === 'and' ? 'or' : 'and',
                          ),
                        )
                      }
                      type="button"
                    >
                      {row.join}
                    </button>
                    <PureFilterItem
                      className="flex-1"
                      eventName=""
                      filter={row.condition}
                      immediateInput
                      onChangeOperator={(operator, original) =>
                        setDraft(
                          updateCondition(draft, row.id, {
                            ...original,
                            operator,
                          }),
                        )
                      }
                      onChangeValue={(nextValue, original) =>
                        setDraft(
                          updateCondition(draft, row.id, {
                            ...original,
                            value: nextValue,
                          }),
                        )
                      }
                      onRemove={() => setDraft(removeCondition(draft, row.id))}
                    />
                  </div>
                ))}

                <div className="row mt-1 gap-2">
                  <PropertiesCombobox
                    categories={[...PANEL_CATEGORIES]}
                    onSelect={(action) =>
                      setDraft(addCondition(draft, card.id, action.value))
                    }
                  >
                    {(setComboOpen) => (
                      <Button
                        onClick={() => setComboOpen((prev) => !prev)}
                        size="sm"
                        variant="ghost"
                      >
                        + Condition
                      </Button>
                    )}
                  </PropertiesCombobox>

                  {/* Level 2 is the last one. The design keeps the button and
                      disables it, so the limit teaches itself. */}
                  <Button
                    disabled={!canAddSubGroup(card.level)}
                    onClick={() => setDraft(addSubGroup(draft))}
                    size="sm"
                    title={
                      canAddSubGroup(card.level)
                        ? 'Add a nested group'
                        : 'Nesting is limited to two levels'
                    }
                    variant="ghost"
                  >
                    + Nested group
                  </Button>

                  {!canAddSubGroup(card.level) && (
                    <span className="self-center text-[11px] text-muted-foreground">
                      Max 2 nesting levels
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>

          <div className="row items-center gap-2 border-t p-2.5">
            <span className="flex-1 text-xs text-muted-foreground">
              Applies to chart and table
            </span>
            {/* Clears the staged edit only — applied filters need the chips or
                Apply, so a stray click cannot wipe a filter already in use. */}
            <Button
              onClick={() => setDraft(emptyGroup())}
              size="sm"
              variant="outline"
            >
              Clear
            </Button>
            <Button
              disabled={applyDisabled}
              onClick={() => {
                onChange(draft.children.length > 0 ? draft : null);
                setOpen(false);
              }}
              size="sm"
            >
              Apply filters
            </Button>
          </div>
        </PopoverContent>
      </Popover>

      {chips.length > 0 && (
        <div className="row flex-wrap items-center gap-1.5">
          {chips.map((chip) => (
            <button
              className="row h-[26px] items-center gap-1.5 rounded-full border bg-def-100 px-2.5 font-mono text-[11px] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-highlight"
              key={chip.id}
              onClick={() => {
                if (!value) return;
                const next = removeCondition(value, chip.id);
                onChange(next.children.length > 0 ? next : null);
              }}
              type="button"
            >
              {chip.text}
              <span aria-hidden className="text-muted-foreground">
                ×
              </span>
            </button>
          ))}
          <button
            className="text-xs text-highlight"
            onClick={() => onChange(null)}
            type="button"
          >
            Clear all
          </button>
        </div>
      )}
    </div>
  );
}
