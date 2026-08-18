import { useEffect, useId, useMemo, useRef, useState } from 'react';

import { describeMediaDevices } from '../features/voice/device-label';
import { CheckIcon, ChevronDownIcon } from './icons';

export function DeviceSelect({
  devices,
  emptyLabel,
  fallbackLabel,
  label,
  onChange,
  value,
  compact = false,
}: {
  devices: MediaDeviceInfo[];
  emptyLabel: string;
  fallbackLabel: string;
  label: string;
  onChange(deviceId: string): void;
  value: string;
  compact?: boolean;
}) {
  const listboxId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const options = useMemo(
    () => describeMediaDevices(devices, fallbackLabel),
    [devices, fallbackLabel],
  );
  const selectedIndex = Math.max(
    0,
    options.findIndex((option) => option.deviceId === value),
  );
  const [activeIndex, setActiveIndex] = useState(selectedIndex);
  const selected = options[selectedIndex];

  useEffect(() => {
    if (!open) return;
    setActiveIndex(selectedIndex);
    const closeOnOutsidePointer = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', closeOnOutsidePointer);
    return () => document.removeEventListener('pointerdown', closeOnOutsidePointer);
  }, [open, selectedIndex]);

  const choose = (index: number) => {
    const option = options[index];
    if (!option) return;
    onChange(option.deviceId);
    setOpen(false);
    buttonRef.current?.focus();
  };

  const move = (offset: number) => {
    if (options.length === 0) return;
    setActiveIndex((current) => (current + offset + options.length) % options.length);
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (!open) {
        setOpen(true);
        setActiveIndex(selectedIndex);
      } else {
        move(event.key === 'ArrowDown' ? 1 : -1);
      }
      return;
    }
    if (event.key === 'Home' && open) {
      event.preventDefault();
      setActiveIndex(0);
      return;
    }
    if (event.key === 'End' && open) {
      event.preventDefault();
      setActiveIndex(options.length - 1);
      return;
    }
    if ((event.key === 'Enter' || event.key === ' ') && open) {
      event.preventDefault();
      choose(activeIndex);
      return;
    }
    if (event.key === 'Escape' && open) {
      event.preventDefault();
      setOpen(false);
    }
  };

  return (
    <div className={`device-select ${compact ? 'is-compact' : ''}`} ref={rootRef}>
      <span className="device-select-label">{label}</span>
      <button
        ref={buttonRef}
        className="device-select-trigger"
        type="button"
        role="combobox"
        aria-controls={listboxId}
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-label={label}
        title={selected?.title ?? emptyLabel}
        disabled={options.length === 0}
        onClick={() => setOpen((current) => !current)}
        onKeyDown={handleKeyDown}
      >
        <span className="device-select-value">
          {selected?.detail && <small>{selected.detail}</small>}
          <span>{selected?.name ?? emptyLabel}</span>
        </span>
        <ChevronDownIcon aria-hidden="true" />
      </button>
      {open && (
        <div className="device-select-popover">
          <div id={listboxId} className="device-select-list" role="listbox" aria-label={label}>
            {options.map((option, index) => (
              <button
                key={option.deviceId}
                className={index === activeIndex ? 'is-active' : ''}
                type="button"
                role="option"
                aria-selected={option.deviceId === value}
                title={option.title}
                onClick={() => choose(index)}
                onPointerMove={() => setActiveIndex(index)}
              >
                <span>
                  {option.detail && <small>{option.detail}</small>}
                  <strong>{option.name}</strong>
                </span>
                {option.deviceId === value && <CheckIcon aria-hidden="true" />}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
