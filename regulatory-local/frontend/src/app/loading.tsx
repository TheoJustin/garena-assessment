import { Loader2 } from 'lucide-react';

import { Progress } from '@/components/ui/progress';

export default function Loading() {
  return (
    <div className="flex min-h-[70vh] items-center justify-center p-6">
      <div className="w-full max-w-xl rounded-2xl border border-zinc-800 bg-zinc-950/90 p-6 shadow-2xl">
        <div className="mb-4 flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-zinc-900">
            <Loader2 className="h-5 w-5 animate-spin text-zinc-300" />
          </div>
          <div>
            <p className="text-sm font-medium text-zinc-100">
              Loading workspace
            </p>
            <p className="text-xs text-zinc-500">
              Preparing the regulatory interface.
            </p>
          </div>
        </div>
        <Progress indeterminate />
      </div>
    </div>
  );
}
