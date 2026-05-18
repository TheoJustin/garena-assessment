import { CheckCircle2, Loader2 } from 'lucide-react';

import { Progress } from '@/components/ui/progress';

type ActivityProgressProps = {
  detail: string;
  label: string;
  progress: number;
  status?: 'active' | 'complete';
};

export function ActivityProgress({
  detail,
  label,
  progress,
  status = 'active',
}: ActivityProgressProps) {
  const isComplete = status === 'complete';

  return (
    <div
      className={`rounded-xl border p-4 ${
        isComplete
          ? 'border-emerald-900/60 bg-emerald-950/20'
          : 'border-zinc-800 bg-zinc-900/80'
      }`}
    >
      <div className="mb-3 flex items-center justify-between gap-3">
        <div>
          <p className="text-sm font-medium text-zinc-100">{label}</p>
          <p
            className={`text-xs ${
              isComplete ? 'text-emerald-200/80' : 'text-zinc-500'
            }`}
          >
            {detail}
          </p>
        </div>
        <div
          className={`flex items-center gap-2 text-xs ${
            isComplete ? 'text-emerald-200' : 'text-zinc-400'
          }`}
        >
          {isComplete ? (
            <CheckCircle2 className="h-3.5 w-3.5" />
          ) : (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          )}
          {Math.round(progress)}%
        </div>
      </div>
      <Progress
        value={progress}
        indicatorClassName={isComplete ? 'bg-emerald-300' : undefined}
      />
    </div>
  );
}
