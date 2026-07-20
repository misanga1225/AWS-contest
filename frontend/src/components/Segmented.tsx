// iOS 風セグメンテッドコントロール。選択肢が少なく相互排他な切替に使う。
// (シフト選択・言語切替。Select より操作が 1 手少なく、現在値が常に見える)

import { cn } from '../lib/cn';

export interface SegmentedOption<T extends string> {
  value: T;
  label: string;
}

export function Segmented<T extends string>({
  options,
  value,
  onChange,
  ariaLabel,
}: {
  options: readonly SegmentedOption<T>[];
  value: T;
  onChange: (value: T) => void;
  ariaLabel: string;
}) {
  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      className="inline-flex items-center gap-0.5 rounded-control bg-sunken p-0.5"
    >
      {options.map((opt) => {
        const selected = opt.value === value;
        return (
          <button
            key={opt.value}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => onChange(opt.value)}
            className={cn(
              'rounded-[8px] px-3 py-1.5 text-sub font-medium outline-none',
              'transition-colors duration-200 ease-standard',
              'focus-visible:ring-3 focus-visible:ring-accent/40',
              selected
                ? // 選択中は白いつまみ。フラットなので影ではなく塗りの差で示す
                  'bg-surface text-label shadow-sm'
                : 'text-label-2 hover:text-label',
            )}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
