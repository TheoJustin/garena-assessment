import { cn } from '@/lib/utils';

type ProgressProps = {
  className?: string;
  indicatorClassName?: string;
  indeterminate?: boolean;
  value?: number;
};

export function Progress({
  className,
  indicatorClassName,
  indeterminate = false,
  value = 0,
}: ProgressProps) {
  const safeValue = Math.max(0, Math.min(100, value));

  return (
    <div
      aria-hidden="true"
      className={cn(
        'relative h-2 w-full overflow-hidden rounded-full bg-zinc-900 ring-1 ring-zinc-800',
        className,
      )}
    >
      <div
        className={cn(
          'h-full rounded-full bg-zinc-100 transition-[width,transform] duration-500 ease-out',
          indeterminate &&
            'w-1/3 animate-[progress-slide_1.2s_ease-in-out_infinite]',
          indicatorClassName,
        )}
        style={indeterminate ? undefined : { width: `${safeValue}%` }}
      />
    </div>
  );
}
