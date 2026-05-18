'use client';

import Link from 'next/link';
import {
  ArrowRight,
  Bot,
  CircleAlert,
  Database,
  FileText,
  Loader2,
  RefreshCcw,
  Server,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  getWorkflowHeadline,
  isWorkflowReady,
  type WorkflowStatus,
  type WorkflowStepStatus,
} from '@/lib/workflow';

type WorkflowStatusPanelProps = {
  actionHref?: string;
  actionLabel?: string;
  error?: string | null;
  isRefreshing?: boolean;
  onRefresh?: () => void;
  status: WorkflowStatus | null;
  title: string;
};

function statusToneClasses(status: WorkflowStepStatus) {
  switch (status) {
    case 'complete':
      return {
        badge: 'border-emerald-900/60 bg-emerald-950/40 text-emerald-200',
        dot: 'bg-emerald-300',
        label: 'Complete',
      };
    case 'ready':
      return {
        badge: 'border-sky-900/60 bg-sky-950/40 text-sky-200',
        dot: 'bg-sky-300',
        label: 'Ready',
      };
    case 'blocked':
      return {
        badge: 'border-amber-900/60 bg-amber-950/40 text-amber-200',
        dot: 'bg-amber-300',
        label: 'Blocked',
      };
    default:
      return {
        badge: 'border-zinc-800 bg-zinc-900 text-zinc-300',
        dot: 'bg-zinc-500',
        label: 'Pending',
      };
  }
}

export function WorkflowStatusPanel({
  actionHref,
  actionLabel,
  error,
  isRefreshing = false,
  onRefresh,
  status,
  title,
}: WorkflowStatusPanelProps) {
  const ready = isWorkflowReady(status);
  const providerLabel = status?.provider.name
    ? status.provider.name.charAt(0).toUpperCase() + status.provider.name.slice(1)
    : 'Provider';

  return (
    <div className="rounded-[1.75rem] border border-zinc-800 bg-zinc-950/95 p-5 shadow-2xl">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-[11px] font-medium uppercase tracking-[0.24em] text-zinc-500">
            Workflow Status
          </p>
          <h2 className="mt-2 text-xl font-semibold tracking-tight text-zinc-50">
            {title}
          </h2>
          <p className="mt-2 max-w-xl text-sm leading-6 text-zinc-400">
            {getWorkflowHeadline(status)}
          </p>
        </div>

        <div className="flex items-center gap-2">
          {onRefresh && (
            <Button
              type="button"
              variant="outline"
              onClick={onRefresh}
              className="h-10 rounded-full border-zinc-800 bg-zinc-950 px-4 text-zinc-300 hover:bg-zinc-900 hover:text-zinc-100"
            >
              {isRefreshing ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <RefreshCcw className="mr-2 h-4 w-4" />
              )}
              Refresh
            </Button>
          )}

          {actionHref && actionLabel && (
            <Link href={actionHref}>
              <Button
                type="button"
                className="h-10 rounded-full bg-zinc-100 px-4 text-zinc-900 hover:bg-zinc-200"
              >
                {actionLabel}
                <ArrowRight className="ml-2 h-4 w-4" />
              </Button>
            </Link>
          )}
        </div>
      </div>

      {error && (
        <div className="mt-5 flex items-start gap-3 rounded-2xl border border-red-900/60 bg-red-950/20 px-4 py-3 text-sm text-red-100">
          <CircleAlert className="mt-0.5 h-4 w-4 shrink-0 text-red-300" />
          <p>{error}</p>
        </div>
      )}

      <div className="mt-5 grid gap-3 sm:grid-cols-3">
        <div className="rounded-2xl border border-zinc-800 bg-zinc-900/70 p-4">
          <div className="flex items-center gap-2 text-zinc-400">
            <FileText className="h-4 w-4" />
            Indexed PDFs
          </div>
          <p className="mt-3 text-3xl font-semibold tracking-tight text-zinc-50">
            {status?.indexed_documents ?? 0}
          </p>
          <p className="mt-2 text-xs leading-5 text-zinc-500">
            Upload a PDF or seed the bundled OJK documents to populate Chroma.
          </p>
        </div>

        <div className="rounded-2xl border border-zinc-800 bg-zinc-900/70 p-4">
          <div className="flex items-center gap-2 text-zinc-400">
            <Database className="h-4 w-4" />
            Stored Chunks
          </div>
          <p className="mt-3 text-3xl font-semibold tracking-tight text-zinc-50">
            {status?.total_chunks ?? 0}
          </p>
          <p className="mt-2 text-xs leading-5 text-zinc-500">
            These local vectors are what the app retrieves before asking the model.
          </p>
        </div>

        <div className="rounded-2xl border border-zinc-800 bg-zinc-900/70 p-4">
          <div className="flex items-center gap-2 text-zinc-400">
            <Bot className="h-4 w-4" />
            {providerLabel}
          </div>
          <p className="mt-3 text-base font-semibold tracking-tight text-zinc-50">
            {status?.provider.chat_model ?? 'Not configured'}
          </p>
          <p className="mt-2 text-xs leading-5 text-zinc-500">
            {ready
              ? 'Chat and embedding models are reachable.'
              : status?.provider.error ?? 'The provider still needs attention before chat can complete.'}
          </p>
        </div>
      </div>

      <div className="mt-5 rounded-2xl border border-zinc-800 bg-zinc-900/60 p-4">
        <div className="flex items-center gap-2 text-sm font-medium text-zinc-200">
          <Server className="h-4 w-4 text-zinc-400" />
          Provider Details
        </div>
        <div className="mt-3 flex flex-wrap gap-2 text-xs text-zinc-300">
          <span className="rounded-full border border-zinc-800 bg-zinc-950 px-3 py-1.5">
            Base URL: {status?.provider.base_url ?? 'Unknown'}
          </span>
          <span className="rounded-full border border-zinc-800 bg-zinc-950 px-3 py-1.5">
            Chat: {status?.provider.chat_model ?? 'Unknown'}
          </span>
          <span className="rounded-full border border-zinc-800 bg-zinc-950 px-3 py-1.5">
            Embeddings: {status?.provider.embedding_model ?? 'Unknown'}
          </span>
        </div>

        {status?.provider.missing_models && status.provider.missing_models.length > 0 && (
          <div className="mt-3 rounded-2xl border border-amber-900/60 bg-amber-950/20 px-4 py-3 text-sm text-amber-100">
            Missing model(s): {status.provider.missing_models.join(', ')}
          </div>
        )}
      </div>

      <div className="mt-5 space-y-3">
        {status?.workflow_steps.map((step) => {
          const tone = statusToneClasses(step.status);

          return (
            <div
              key={step.id}
              className="flex items-start gap-3 rounded-2xl border border-zinc-800 bg-zinc-900/55 px-4 py-3"
            >
              <span className={`mt-1 h-2.5 w-2.5 rounded-full ${tone.dot}`} />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-sm font-medium text-zinc-100">{step.label}</p>
                  <span
                    className={`rounded-full border px-2.5 py-0.5 text-[11px] ${tone.badge}`}
                  >
                    {tone.label}
                  </span>
                </div>
                <p className="mt-1 text-sm leading-6 text-zinc-400">{step.detail}</p>
              </div>
            </div>
          );
        })}
      </div>

      {status && (
        <div className="mt-5 rounded-2xl border border-zinc-800 bg-[linear-gradient(135deg,rgba(34,197,94,0.08),rgba(59,130,246,0.05),rgba(24,24,27,0.65))] px-4 py-4">
          <p className="text-[11px] font-medium uppercase tracking-[0.24em] text-zinc-500">
            Recommended Next Step
          </p>
          <p className="mt-2 text-sm leading-6 text-zinc-200">
            {status.recommended_next_action}
          </p>
        </div>
      )}
    </div>
  );
}
