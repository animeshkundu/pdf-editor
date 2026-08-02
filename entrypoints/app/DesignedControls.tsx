import {
  useId,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type PointerEvent,
  type ReactElement,
  type ReactNode,
} from 'react';
import * as Popover from '@radix-ui/react-popover';
import * as Select from '@radix-ui/react-select';
import * as Tooltip from '@radix-ui/react-tooltip';
import { Check, ChevronDown, ChevronsUpDown } from 'lucide-react';

export interface SelectOption<T extends string> {
  readonly value: T;
  readonly label: string;
  readonly disabled?: boolean;
}

export function DesignedTooltip({
  label,
  children,
}: {
  readonly label: string;
  readonly children: ReactElement;
}) {
  return (
    <Tooltip.Root>
      <Tooltip.Trigger asChild>{children}</Tooltip.Trigger>
      <Tooltip.Portal>
        <Tooltip.Content className="designed-tooltip" sideOffset={7}>
          {label}
          <Tooltip.Arrow className="designed-tooltip-arrow" />
        </Tooltip.Content>
      </Tooltip.Portal>
    </Tooltip.Root>
  );
}

export function DesignedSelect<T extends string>({
  label,
  value,
  options,
  onValueChange,
  disabled = false,
  describedBy,
}: {
  readonly label: string;
  readonly value: T;
  readonly options: readonly SelectOption<T>[];
  readonly onValueChange: (value: T) => void;
  readonly disabled?: boolean;
  readonly describedBy?: string;
}) {
  return (
    <Select.Root
      value={value}
      disabled={disabled}
      onValueChange={(nextValue) => onValueChange(nextValue as T)}
    >
      <Select.Trigger
        className="designed-select"
        aria-label={label}
        aria-describedby={describedBy}
      >
        <Select.Value />
        <Select.Icon>
          <ChevronsUpDown aria-hidden="true" size={14} />
        </Select.Icon>
      </Select.Trigger>
      <Select.Portal>
        <Select.Content className="designed-select-menu" position="popper" sideOffset={4}>
          <Select.Viewport>
            {options.map((option) => (
              <Select.Item
                className="designed-select-option"
                key={option.value}
                value={option.value}
                {...(option.disabled ? { disabled: true } : {})}
              >
                <Select.ItemText>{option.label}</Select.ItemText>
                <Select.ItemIndicator>
                  <Check aria-hidden="true" size={14} />
                </Select.ItemIndicator>
              </Select.Item>
            ))}
          </Select.Viewport>
        </Select.Content>
      </Select.Portal>
    </Select.Root>
  );
}

export function DesignedCheckbox({
  label,
  checked,
  onCheckedChange,
  disabled = false,
  describedBy,
}: {
  readonly label: ReactNode;
  readonly checked: boolean;
  readonly onCheckedChange: (checked: boolean) => void;
  readonly disabled?: boolean;
  readonly describedBy?: string;
}) {
  const labelId = useId();
  return (
    <span className="designed-checkbox">
      <button
        type="button"
        role="checkbox"
        aria-checked={checked}
        disabled={disabled}
        aria-labelledby={labelId}
        aria-describedby={describedBy}
        onClick={() => onCheckedChange(!checked)}
      >
        {checked ? <Check aria-hidden="true" size={14} /> : null}
      </button>
      <span id={labelId}>{label}</span>
    </span>
  );
}

export function DesignedSlider({
  label,
  value,
  valueText,
  min,
  max,
  step,
  onValueChange,
}: {
  readonly label: string;
  readonly value: number;
  readonly valueText?: string;
  readonly min: number;
  readonly max: number;
  readonly step: number;
  readonly onValueChange: (value: number) => void;
}) {
  const updateFromPointer = (event: PointerEvent<HTMLDivElement>) => {
    const bounds = event.currentTarget.getBoundingClientRect();
    const ratio = bounds.width > 0 ? (event.clientX - bounds.left) / bounds.width : 0;
    const stepped = Math.round((min + ratio * (max - min)) / step) * step;
    onValueChange(Math.min(max, Math.max(min, stepped)));
  };
  const updateFromKey = (event: KeyboardEvent<HTMLDivElement>) => {
    const direction =
      event.key === 'ArrowRight' || event.key === 'ArrowUp'
        ? 1
        : event.key === 'ArrowLeft' || event.key === 'ArrowDown'
          ? -1
          : 0;
    if (direction !== 0) {
      event.preventDefault();
      onValueChange(Math.min(max, Math.max(min, value + direction * step)));
    } else if (event.key === 'Home') {
      event.preventDefault();
      onValueChange(min);
    } else if (event.key === 'End') {
      event.preventDefault();
      onValueChange(max);
    }
  };
  const progress = max === min ? 0 : ((value - min) / (max - min)) * 100;
  return (
    <div
      tabIndex={0}
      className="designed-slider"
      role="slider"
      aria-label={label}
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={value}
      aria-valuetext={valueText}
      style={{ '--slider-progress': `${progress}%` } as CSSProperties}
      onPointerDown={(event) => {
        event.currentTarget.setPointerCapture(event.pointerId);
        updateFromPointer(event);
      }}
      onPointerMove={(event) => {
        if (event.currentTarget.hasPointerCapture(event.pointerId)) updateFromPointer(event);
      }}
      onPointerUp={(event) => {
        if (event.currentTarget.hasPointerCapture(event.pointerId)) {
          event.currentTarget.releasePointerCapture(event.pointerId);
        }
      }}
      onKeyDown={updateFromKey}
    >
      <span aria-hidden="true">
        <span />
      </span>
      <span aria-hidden="true" />
    </div>
  );
}

const COLOR_CHOICES = [
  '#15181d',
  '#3853d8',
  '#b4232b',
  '#7a4d00',
  '#176b43',
  '#ffffff',
] as const;

export function DesignedColorPicker({
  label,
  value,
  onValueChange,
}: {
  readonly label: string;
  readonly value: string;
  readonly onValueChange: (value: string) => void;
}) {
  const [draft, setDraft] = useState(value);
  const colorStyle = { '--selected-color': value } as CSSProperties;
  return (
    <Popover.Root
      onOpenChange={(open) => {
        if (open) setDraft(value);
      }}
    >
      <Popover.Trigger asChild>
        <button
          type="button"
          className="designed-color-trigger"
          aria-label={`${label}: ${value}`}
          style={colorStyle}
        >
          <span aria-hidden="true" />
          <span>{value.toLocaleUpperCase()}</span>
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          className="designed-color-popover"
          aria-label={`${label} choices`}
          sideOffset={4}
        >
          <div className="designed-color-grid">
            {COLOR_CHOICES.map((color) => (
              <button
                type="button"
                key={color}
                aria-label={`Use ${color}`}
                aria-pressed={value.toLocaleLowerCase() === color}
                style={{ '--selected-color': color } as CSSProperties}
                onClick={() => {
                  onValueChange(color);
                  setDraft(color);
                }}
              >
                <span aria-hidden="true" />
              </button>
            ))}
          </div>
          <label>
            <span>Hex colour</span>
            <input
              value={draft}
              inputMode="text"
              pattern="#[0-9a-fA-F]{6}"
              onChange={(event) => setDraft(event.target.value)}
              onBlur={() => {
                if (/^#[0-9a-f]{6}$/i.test(draft)) onValueChange(draft);
                else setDraft(value);
              }}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && /^#[0-9a-f]{6}$/i.test(draft)) {
                  onValueChange(draft);
                }
              }}
            />
          </label>
          <Popover.Arrow className="designed-popover-arrow" />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

export function DesignedDisclosure({
  title,
  children,
  className,
  defaultOpen = false,
}: {
  readonly title: ReactNode;
  readonly children: ReactNode;
  readonly className: string;
  readonly defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const contentId = useId();
  return (
    <div className={className} data-state={open ? 'open' : 'closed'}>
      <button
        type="button"
        className="disclosure-trigger"
        aria-expanded={open}
        aria-controls={contentId}
        onClick={() => setOpen((current) => !current)}
      >
        <span>{title}</span>
        <ChevronDown aria-hidden="true" size={16} />
      </button>
      <div id={contentId} hidden={!open}>
        {children}
      </div>
    </div>
  );
}
