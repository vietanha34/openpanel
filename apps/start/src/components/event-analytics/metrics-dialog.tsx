import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { useEventProperties } from '@/hooks/use-event-properties';
import { cn } from '@/utils/cn';
import {
  DndContext,
  type DragEndEvent,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import {
  SortableContext,
  rectSortingStrategy,
  sortableKeyboardCoordinates,
  useSortable,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import {
  EVENT_ANALYTICS_MAX_METRICS,
  EVENT_ANALYTICS_METRICS,
  type IEventAnalyticsMetric,
} from '@openpanel/validation';
import {
  CheckIcon,
  ChevronDownIcon,
  CircleHelpIcon,
  Columns3Icon,
  GripVerticalIcon,
  PlusIcon,
  SearchIcon,
  XIcon,
} from 'lucide-react';
import { useState } from 'react';
import {
  type DraftMetric,
  type MetricsSort,
  addMetric,
  applyDraft,
  canApply,
  catalogueGroups,
  chipLabel,
  closeParam,
  counterLabel,
  createDraft,
  moveMetric,
  openParam,
  parameterOptions,
  removeMetric,
  setParam,
  toolbarLabel,
} from './metrics-state';

/** Pointer travel before a chip drag starts, so a click still opens it. */
const DRAG_ACTIVATION_PX = 5;

interface MetricsDialogProps {
  projectId: string;
  metrics: IEventAnalyticsMetric[];
  sort: MetricsSort;
  disabled?: boolean;
  onApply: (result: {
    metrics: IEventAnalyticsMetric[];
    sort: MetricsSort;
  }) => void;
}

/** Toolbar button plus the Metrics dialog (design states 2a / 2b). */
export function MetricsDialog({
  projectId,
  metrics,
  sort,
  disabled,
  onApply,
}: MetricsDialogProps) {
  const [open, setOpen] = useState(false);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          variant="outline"
          className={cn('gap-2', open && 'bg-foreground text-background')}
          disabled={disabled}
        >
          <Columns3Icon size={15} />
          {toolbarLabel(metrics)}
          <ChevronDownIcon size={14} className="opacity-60" />
        </Button>
      </DialogTrigger>
      <DialogContent className="top-[120px] flex w-auto max-w-none translate-y-0 items-start gap-0 overflow-visible border-0 bg-transparent p-0 shadow-none sm:max-w-none md:max-h-none">
        {/* Radix unmounts the content when closed, so every open starts a
            fresh draft and Cancel needs no restore step. */}
        <MetricsDialogBody
          projectId={projectId}
          metrics={metrics}
          onCancel={() => setOpen(false)}
          onApply={(draftMetrics) => {
            const result = applyDraft(
              { metrics: draftMetrics, editing: null },
              sort,
            );
            if (result) {
              onApply(result);
              setOpen(false);
            }
          }}
        />
      </DialogContent>
    </Dialog>
  );
}

function MetricsDialogBody({
  projectId,
  metrics,
  onCancel,
  onApply,
}: {
  projectId: string;
  metrics: IEventAnalyticsMetric[];
  onCancel: () => void;
  onApply: (metrics: DraftMetric[]) => void;
}) {
  const [draft, setDraft] = useState(() => createDraft(metrics));
  const [pickerOpen, setPickerOpen] = useState(true);
  const [metricSearch, setMetricSearch] = useState('');
  const [paramSearch, setParamSearch] = useState('');
  const propertyNames = useEventProperties({ projectId });

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: DRAG_ACTIVATION_PX },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  const onDragEnd = ({ active, over }: DragEndEvent) => {
    if (over) {
      setDraft((current) =>
        moveMetric(current, Number(active.id), Number(over.id)),
      );
    }
  };

  const openParamFor = (index: number) => {
    setDraft((current) => openParam(current, index));
    setPickerOpen(false);
    setParamSearch('');
  };

  const pickMetric = (id: DraftMetric['id']) => {
    const next = addMetric(draft, id);
    setDraft(next);
    if (next.editing !== null && next.editing !== draft.editing) {
      setPickerOpen(false);
      setParamSearch('');
    }
  };

  const editingIndex = draft.editing;
  const editingMetric =
    editingIndex === null ? undefined : draft.metrics[editingIndex];
  const full = draft.metrics.length >= EVENT_ANALYTICS_MAX_METRICS;

  return (
    <>
      <div className="col relative w-[470px] gap-3.5 rounded-[10px] border bg-card p-[22px] shadow-xl">
        <div>
          <DialogTitle className="font-semibold text-[19px] tracking-tight">
            Metrics
          </DialogTitle>
          <DialogDescription className="mt-1.5 text-[13px]">
            Select metrics to customize{' '}
            <span className="font-semibold text-foreground">
              which columns to display
            </span>{' '}
            in the table
          </DialogDescription>
        </div>

        <div className="relative flex flex-wrap gap-2 rounded-lg border bg-card p-2.5">
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={onDragEnd}
          >
            <SortableContext
              items={draft.metrics.map((_, index) => String(index))}
              strategy={rectSortingStrategy}
            >
              {draft.metrics.map((metric, index) => (
                <MetricChip
                  // Index ids: the same metric may appear twice (A5), so
                  // neither the id nor the metric key is unique.
                  // biome-ignore lint/suspicious/noArrayIndexKey: see above
                  key={index}
                  id={String(index)}
                  metric={metric}
                  active={draft.editing === index}
                  onOpen={() => openParamFor(index)}
                  onRemove={() =>
                    setDraft((current) => removeMetric(current, index))
                  }
                />
              ))}
            </SortableContext>
          </DndContext>
          <button
            type="button"
            title="Add metric"
            aria-label="Add metric"
            className={cn(
              'center-center size-8 rounded-md bg-def-100 text-muted-foreground hover:bg-def-200',
              full && 'opacity-40',
            )}
            onClick={() => {
              setPickerOpen((value) => !value);
              setDraft(closeParam);
            }}
          >
            <PlusIcon size={15} />
          </button>

          {editingIndex !== null && editingMetric ? (
            <ParameterDropdown
              options={parameterOptions(propertyNames, paramSearch)}
              current={editingMetric.param}
              search={paramSearch}
              onSearch={setParamSearch}
              onPick={(param) => {
                setDraft((current) => setParam(current, editingIndex, param));
                setPickerOpen(true);
              }}
            />
          ) : null}
        </div>

        <ul className="col list-disc gap-2 pl-[18px] text-[13px] text-muted-foreground leading-snug">
          <li>
            Some metrics can't be removed from the list, but you can reorder
            them.
          </li>
          <li>
            You can manually select up to 10 metrics, but some report types may
            display more than 10 metrics in the table.
          </li>
          <li>Drag metrics in the list above to reorder columns.</li>
        </ul>

        <div className="row mt-[38px] items-center gap-2.5">
          <Button
            className="h-[38px] px-[22px] text-sm"
            disabled={!canApply(draft)}
            onClick={() => onApply(draft.metrics)}
          >
            Apply
          </Button>
          <Button
            variant="outline"
            className="h-[38px] px-5 text-sm"
            onClick={onCancel}
          >
            Cancel
          </Button>
          <div className="flex-1" />
          <span className="text-muted-foreground text-xs">
            {counterLabel(draft.metrics.length)}
          </span>
        </div>
      </div>

      {pickerOpen ? (
        <div className="col -mt-[22px] -ml-3 max-h-[620px] w-[458px] overflow-hidden rounded-[10px] border bg-card shadow-xl">
          <div className="row h-12 shrink-0 items-center gap-2 border-b px-4">
            <SearchIcon size={15} className="text-muted-foreground" />
            <input
              type="text"
              placeholder="Search"
              aria-label="Search metrics"
              value={metricSearch}
              onChange={(event) => setMetricSearch(event.target.value)}
              className="min-w-0 flex-1 bg-transparent text-sm outline-none"
            />
          </div>
          <div className="flex-1 overflow-auto px-2 pt-2.5 pb-3.5">
            {catalogueGroups(metricSearch).map((group) => (
              <div key={group.group} className="col mb-1.5">
                <div className="row h-[34px] items-center gap-2 px-2.5 font-semibold text-[13px]">
                  <ChevronDownIcon
                    size={14}
                    className="text-muted-foreground"
                  />
                  {group.title}
                </div>
                {group.items.map((item) => {
                  const checked = draft.metrics.some(
                    (metric) => metric.id === item.id,
                  );
                  return (
                    <button
                      key={item.id}
                      type="button"
                      title={item.help}
                      aria-pressed={checked}
                      className="row h-9 items-center gap-2 rounded-md pr-2.5 pl-[31px] text-left text-[13px] hover:bg-def-100"
                      onClick={() => pickMetric(item.id)}
                    >
                      <span className="flex-1 truncate">{item.label}</span>
                      <CircleHelpIcon
                        size={14}
                        className="shrink-0 text-muted-foreground/60"
                      />
                      <CheckIcon
                        size={15}
                        className={cn('shrink-0', !checked && 'opacity-0')}
                      />
                    </button>
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </>
  );
}

function MetricChip({
  id,
  metric,
  active,
  onOpen,
  onRemove,
}: {
  id: string;
  metric: DraftMetric;
  active: boolean;
  onOpen: () => void;
  onRemove: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition } =
    useSortable({ id });
  const def = EVENT_ANALYTICS_METRICS[metric.id];
  const label = chipLabel(metric);

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn(
        'row h-8 items-center gap-1.5 rounded-md border bg-def-100 px-[7px] text-[13px]',
        active && 'border-highlight/40 bg-highlight/10',
      )}
    >
      <button
        type="button"
        aria-label={`Reorder ${label}`}
        className="cursor-grab text-muted-foreground/60"
        {...attributes}
        {...listeners}
      >
        <GripVerticalIcon size={13} />
      </button>
      {def.param ? (
        <button
          type="button"
          className="whitespace-nowrap"
          aria-expanded={active}
          onClick={onOpen}
        >
          {label}
        </button>
      ) : (
        <span className="whitespace-nowrap">{label}</span>
      )}
      {def.locked ? null : (
        <button
          type="button"
          aria-label={`Remove ${label}`}
          className="center-center size-[18px] rounded text-muted-foreground hover:bg-def-200"
          onClick={onRemove}
        >
          <XIcon size={13} />
        </button>
      )}
    </div>
  );
}

function ParameterDropdown({
  options,
  current,
  search,
  onSearch,
  onPick,
}: {
  options: string[];
  current: string | undefined;
  search: string;
  onSearch: (value: string) => void;
  onPick: (param: string) => void;
}) {
  return (
    <div className="col absolute top-[calc(100%+6px)] left-5 z-10 max-h-[420px] w-[212px] overflow-hidden rounded-lg border bg-card shadow-xl">
      <div className="row h-10 shrink-0 items-center border-b px-3">
        <input
          type="text"
          placeholder="Search"
          aria-label="Search parameters"
          value={search}
          onChange={(event) => onSearch(event.target.value)}
          className="min-w-0 flex-1 bg-transparent text-[13px] outline-none"
        />
      </div>
      <div className="flex-1 overflow-auto p-1.5">
        {options.length === 0 ? (
          <div className="px-2 py-2 text-muted-foreground text-xs">
            No parameters
          </div>
        ) : (
          options.map((param) => (
            <button
              key={param}
              type="button"
              className="row h-[34px] w-full items-center gap-2 rounded-[5px] px-2 text-left hover:bg-def-100"
              onClick={() => onPick(param)}
            >
              <span className="flex-1 truncate font-mono text-xs">{param}</span>
              <CheckIcon
                size={14}
                className={cn('shrink-0', param !== current && 'opacity-0')}
              />
            </button>
          ))
        )}
      </div>
    </div>
  );
}
