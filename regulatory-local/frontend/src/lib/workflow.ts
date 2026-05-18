export const BACKEND_URL =
  process.env.NEXT_PUBLIC_BACKEND_URL ?? 'http://localhost:8001';

function readPublicTimeout(
  rawValue: string | undefined,
  fallbackValue: number,
): number {
  const parsed = Number.parseInt(rawValue ?? '', 10);

  if (!Number.isFinite(parsed) || parsed < 1000) {
    return fallbackValue;
  }

  return parsed;
}

export const BACKEND_FETCH_TIMEOUT_MS = readPublicTimeout(
  process.env.NEXT_PUBLIC_BACKEND_FETCH_TIMEOUT_MS,
  120000,
);

export type WorkflowStepStatus = 'blocked' | 'complete' | 'pending' | 'ready';

export type ProviderStatus = {
  available_models: string[];
  base_url: string;
  chat_model: string;
  configured: boolean;
  embedding_model: string;
  error?: string | null;
  missing_models: string[];
  name: string;
  reachable: boolean;
};

export type WorkflowStep = {
  detail: string;
  id: string;
  label: string;
  status: WorkflowStepStatus;
};

export type WorkflowStatus = {
  indexed_documents: number;
  provider: ProviderStatus;
  recommended_next_action: string;
  total_chunks: number;
  workflow_steps: WorkflowStep[];
};

export async function readJsonResponse<T>(
  response: Response,
  fallbackMessage: string,
): Promise<T> {
  const rawText = await response.text();

  if (!rawText.trim()) {
    if (!response.ok) {
      throw new Error(fallbackMessage);
    }

    return {} as T;
  }

  try {
    const parsed = JSON.parse(rawText) as T & {
      detail?: string;
      details?: string;
      error?: string;
    };

    if (!response.ok) {
      throw new Error(
        parsed.detail ?? parsed.details ?? parsed.error ?? fallbackMessage,
      );
    }

    return parsed;
  } catch (error) {
    if (!response.ok) {
      throw error instanceof Error ? error : new Error(fallbackMessage);
    }

    throw new Error(fallbackMessage);
  }
}

export async function fetchJsonWithTimeout<T>(
  input: RequestInfo | URL,
  init: RequestInit = {},
  timeoutMs = BACKEND_FETCH_TIMEOUT_MS,
): Promise<T> {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), timeoutMs);

  try {
    let response: Response;

    try {
      response = await fetch(input, {
        ...init,
        signal: controller.signal,
      });
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        throw new Error(
          'The backend is still busy. If Pinecone is syncing many indexed PDFs or the chat provider is under load, wait a moment and refresh again. You can also raise NEXT_PUBLIC_BACKEND_FETCH_TIMEOUT_MS.',
        );
      }

      throw error;
    }

    return readJsonResponse<T>(response, 'The server returned an invalid response.');
  } finally {
    window.clearTimeout(timeout);
  }
}

export function isWorkflowReady(status: WorkflowStatus | null) {
  return Boolean(
    status &&
      status.indexed_documents > 0 &&
      status.total_chunks > 0 &&
      status.provider.configured &&
      status.provider.reachable &&
      status.provider.missing_models.length === 0,
  );
}

export function getWorkflowHeadline(status: WorkflowStatus | null) {
  if (!status) {
    return 'Checking the local regulatory pipeline...';
  }

  if (isWorkflowReady(status)) {
    return 'Workflow ready for grounded questions';
  }

  if (status.indexed_documents === 0) {
    return 'Waiting for the first PDF to be indexed';
  }

  if (!status.provider.configured) {
    return 'Provider configuration still needs attention';
  }

  if (!status.provider.reachable) {
    return `Waiting for ${status.provider.name} to become reachable`;
  }

  if (status.provider.missing_models.length > 0) {
    return 'Configured models are not available yet';
  }

  return 'One or more workflow steps still need attention';
}
