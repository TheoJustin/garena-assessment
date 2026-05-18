'use client';

import { useEffect, useState } from 'react';
import {
  AlertCircle,
  ArrowRight,
  CheckCircle2,
  FileText,
  Loader2,
  Sparkles,
  UploadCloud,
} from 'lucide-react';

import { ActivityProgress } from '@/components/activity-progress';
import { WorkflowStatusPanel } from '@/components/workflow-status-panel';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  BACKEND_URL,
  fetchJsonWithTimeout,
  readJsonResponse,
  type WorkflowStatus,
} from '@/lib/workflow';

const UPLOAD_STAGES = [
  {
    threshold: 0,
    label: 'Uploading PDF',
    detail: 'Sending the file to the backend.',
  },
  {
    threshold: 32,
    label: 'Extracting text',
    detail: 'Reading the PDF pages and pulling out text.',
  },
  {
    threshold: 58,
    label: 'Chunking document',
    detail: 'Splitting the regulation into retrieval-friendly sections.',
  },
  {
    threshold: 82,
    label: 'Indexing in Chroma',
    detail: 'Embedding chunks and storing them locally.',
  },
];

const SEED_STAGES = [
  {
    threshold: 0,
    label: 'Scanning bundled PDFs',
    detail: 'Finding the bundled regulatory documents.',
  },
  {
    threshold: 25,
    label: 'Reading regulations',
    detail: 'Extracting text from each bundled PDF.',
  },
  {
    threshold: 55,
    label: 'Preparing chunks',
    detail: 'Segmenting pages for retrieval and explanation.',
  },
  {
    threshold: 82,
    label: 'Writing local vectors',
    detail: 'Persisting embeddings to the local Chroma store.',
  },
];

const WORKFLOW_STEPS = [
  'PDF upload',
  'Chunking',
  'ChromaDB',
  'Question',
  'Ollama / OpenRouter',
  'Answer',
];

type IndexedDocument = {
  source: string;
  pages: number;
  chunks: number;
  chunks_indexed: number;
  chunks_skipped: number;
};

type DocumentsResponse = {
  documents: IndexedDocument[];
  total_chunks: number;
};

type IngestionResponse = {
  documents: IndexedDocument[];
  total_chunks_indexed: number;
  total_chunks_skipped: number;
};

type ProgressState = {
  detail: string;
  label: string;
  progress: number;
  status: 'active' | 'complete';
};

type StatusState = {
  message: string;
  tone: 'error' | 'success';
};

function getStage(
  stages: typeof UPLOAD_STAGES,
  progress: number,
): { label: string; detail: string } {
  let activeStage = stages[0];

  for (const stage of stages) {
    if (progress >= stage.threshold) {
      activeStage = stage;
    }
  }

  return activeStage;
}

function buildSuccessMessage(data: IngestionResponse) {
  const names = data.documents.map((document) => document.source).join(', ');

  if (data.total_chunks_skipped > 0 && data.total_chunks_indexed === 0) {
    return `Everything was already indexed for ${names}. Reused ${data.total_chunks_skipped} existing chunks.`;
  }

  if (data.total_chunks_skipped > 0) {
    return `Indexed ${data.total_chunks_indexed} new chunks for ${names} and reused ${data.total_chunks_skipped} existing chunk(s).`;
  }

  return `Indexed ${data.total_chunks_indexed} new chunks for ${names}.`;
}

function parseXhrPayload<T>(xhr: XMLHttpRequest): T | null {
  if (xhr.response && typeof xhr.response === 'object') {
    return xhr.response as T;
  }

  if (!xhr.responseText?.trim()) {
    return null;
  }

  try {
    return JSON.parse(xhr.responseText) as T;
  } catch {
    return null;
  }
}

function uploadPdf(
  file: File,
  onProgress: (progress: number) => void,
  onUploadComplete: () => void,
) {
  return new Promise<IngestionResponse>((resolve, reject) => {
    const formData = new FormData();
    formData.append('file', file);

    const xhr = new XMLHttpRequest();
    xhr.open('POST', `${BACKEND_URL}/process-pdf`);
    xhr.responseType = 'json';
    xhr.timeout = 180000;

    xhr.upload.onprogress = (event) => {
      if (!event.lengthComputable) return;

      const uploadShare = (event.loaded / event.total) * 32;
      onProgress(uploadShare);
    };

    xhr.upload.onload = () => {
      onUploadComplete();
    };

    xhr.onerror = () => {
      reject(
        new Error(
          'Network error during upload. Make sure the backend is reachable on port 8001.',
        ),
      );
    };

    xhr.ontimeout = () => {
      reject(
        new Error(
          'The upload timed out while waiting for indexing to finish. Check the backend logs and provider connectivity.',
        ),
      );
    };

    xhr.onload = () => {
      const response = parseXhrPayload<IngestionResponse>(xhr);
      const errorResponse = parseXhrPayload<{ detail?: string; error?: string }>(xhr);

      if (xhr.status >= 200 && xhr.status < 300 && response) {
        resolve(response);
        return;
      }

      reject(
        new Error(
          errorResponse?.detail ??
            errorResponse?.error ??
            'The backend rejected the uploaded document.',
        ),
      );
    };

    xhr.send(formData);
  });
}

export default function UploadPage() {
  const [file, setFile] = useState<File | null>(null);
  const [indexedDocuments, setIndexedDocuments] = useState<IndexedDocument[]>([]);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isSeeding, setIsSeeding] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [progressState, setProgressState] = useState<ProgressState | null>(null);
  const [shouldAutoAdvance, setShouldAutoAdvance] = useState(false);
  const [statusState, setStatusState] = useState<StatusState | null>(null);
  const [totalChunks, setTotalChunks] = useState(0);
  const [workflowError, setWorkflowError] = useState<string | null>(null);
  const [workflowStatus, setWorkflowStatus] = useState<WorkflowStatus | null>(null);

  const refreshDashboard = async () => {
    setIsRefreshing(true);
    setWorkflowError(null);

    try {
      const [documents, workflow] = await Promise.all([
        fetchJsonWithTimeout<DocumentsResponse>(
          `${BACKEND_URL}/documents`,
          { cache: 'no-store' },
          15000,
        ),
        fetchJsonWithTimeout<WorkflowStatus>(
          `${BACKEND_URL}/workflow-status`,
          { cache: 'no-store' },
          15000,
        ),
      ]);

      setIndexedDocuments(documents.documents);
      setTotalChunks(documents.total_chunks);
      setWorkflowStatus(workflow);
    } catch (error) {
      console.error('Failed to refresh workflow dashboard', error);
      setWorkflowError(
        error instanceof Error
          ? error.message
          : 'Failed to load the workflow status from the backend.',
      );
    } finally {
      setIsRefreshing(false);
    }
  };

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      void refreshDashboard();
    }, 0);

    return () => {
      window.clearTimeout(timeout);
    };
  }, []);

  useEffect(() => {
    if (!progressState || !shouldAutoAdvance || progressState.status !== 'active') {
      return;
    }

    const stages = isSeeding ? SEED_STAGES : UPLOAD_STAGES;
    const interval = window.setInterval(() => {
      setProgressState((current) => {
        if (!current) return current;

        const nextProgress = Math.min(
          94,
          current.progress + Math.max(1.75, (95 - current.progress) / 6),
        );
        const stage = getStage(stages, nextProgress);

        return {
          detail: stage.detail,
          label: stage.label,
          progress: nextProgress,
          status: 'active',
        };
      });
    }, 380);

    return () => {
      window.clearInterval(interval);
    };
  }, [isSeeding, progressState, shouldAutoAdvance]);

  useEffect(() => {
    if (!progressState || progressState.status !== 'complete') return;

    const timeout = window.setTimeout(() => {
      setProgressState((current) =>
        current?.status === 'complete' ? null : current,
      );
    }, 1800);

    return () => {
      window.clearTimeout(timeout);
    };
  }, [progressState]);

  const handleExtract = async () => {
    if (!file) return;

    setIsUploading(true);
    setStatusState(null);
    setProgressState({
      detail: UPLOAD_STAGES[0].detail,
      label: UPLOAD_STAGES[0].label,
      progress: 4,
      status: 'active',
    });
    setShouldAutoAdvance(false);

    try {
      const data = await uploadPdf(
        file,
        (progress) => {
          const stage = getStage(UPLOAD_STAGES, progress);
          setProgressState({
            detail: stage.detail,
            label: stage.label,
            progress,
            status: 'active',
          });
        },
        () => {
          setShouldAutoAdvance(true);
          setProgressState({
            detail: UPLOAD_STAGES[1].detail,
            label: UPLOAD_STAGES[1].label,
            progress: 34,
            status: 'active',
          });
        },
      );

      setProgressState({
        detail: 'The document is now available for retrieval.',
        label: 'Indexed successfully',
        progress: 100,
        status: 'complete',
      });
      setStatusState({
        message: buildSuccessMessage(data),
        tone: 'success',
      });
      setFile(null);
      await refreshDashboard();
    } catch (error) {
      console.error('Upload failed', error);
      setStatusState({
        message:
          error instanceof Error
            ? error.message
            : 'Upload failed. Check the backend logs and your env.',
        tone: 'error',
      });
      setProgressState(null);
    } finally {
      setShouldAutoAdvance(false);
      setIsUploading(false);
    }
  };

  const handleSeedDocuments = async () => {
    setIsSeeding(true);
    setStatusState(null);
    setProgressState({
      detail: SEED_STAGES[0].detail,
      label: SEED_STAGES[0].label,
      progress: 8,
      status: 'active',
    });
    setShouldAutoAdvance(true);

    try {
      const response = await fetch(`${BACKEND_URL}/ingest-bundled-documents`, {
        method: 'POST',
      });
      const data = await readJsonResponse<IngestionResponse>(
        response,
        'Bundled document ingestion failed.',
      );

      setProgressState({
        detail: 'Bundled documents are ready for Q&A.',
        label: 'Seed completed',
        progress: 100,
        status: 'complete',
      });
      setStatusState({
        message: buildSuccessMessage(data),
        tone: 'success',
      });
      await refreshDashboard();
    } catch (error) {
      console.error('Bundled ingestion failed', error);
      setStatusState({
        message:
          error instanceof Error
            ? error.message
            : 'Bundled ingestion failed. Check the backend logs.',
        tone: 'error',
      });
      setProgressState(null);
    } finally {
      setShouldAutoAdvance(false);
      setIsSeeding(false);
    }
  };

  return (
    <div className="min-h-[88vh] px-4 py-6 md:px-6 md:py-8">
      <div className="mx-auto max-w-7xl space-y-6">
        <section className="overflow-hidden rounded-[2rem] border border-zinc-800 bg-[radial-gradient(circle_at_top,_rgba(255,255,255,0.08),_rgba(24,24,27,0.94)_42%,_rgba(10,10,12,1)_100%)] px-6 py-7 shadow-2xl md:px-8">
          <div className="flex flex-col gap-5 xl:flex-row xl:items-end xl:justify-between">
            <div className="max-w-3xl">
              <p className="inline-flex items-center gap-2 rounded-full border border-zinc-800 bg-zinc-900/70 px-3 py-1 text-[11px] font-medium uppercase tracking-[0.22em] text-zinc-400">
                <Sparkles className="h-3.5 w-3.5" />
                Local Regulatory Workflow
              </p>
              <h1 className="mt-4 text-3xl font-semibold tracking-tight text-zinc-50 md:text-4xl">
                Move a regulation from PDF to an answerable local knowledge base
              </h1>
              <p className="mt-3 max-w-2xl text-sm leading-6 text-zinc-400 md:text-[15px]">
                This screen covers the ingestion half of the workflow: upload or
                seed PDFs, chunk them, write vectors to ChromaDB, then hand the
                indexed knowledge base to the chat interface.
              </p>
            </div>

            <div className="rounded-[1.5rem] border border-zinc-800 bg-zinc-950/80 px-5 py-4 text-sm text-zinc-300 shadow-lg">
              <p className="text-[11px] font-medium uppercase tracking-[0.24em] text-zinc-500">
                Pipeline
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                {WORKFLOW_STEPS.map((step) => (
                  <span
                    key={step}
                    className="rounded-full border border-zinc-800 bg-zinc-900/80 px-3 py-1.5 text-xs text-zinc-300"
                  >
                    {step}
                  </span>
                ))}
              </div>
            </div>
          </div>
        </section>

        <div className="grid gap-6 xl:grid-cols-[1.08fr_0.92fr]">
          <div className="space-y-6">
            <Card className="border-zinc-800 bg-zinc-950 text-zinc-100 shadow-2xl">
              <CardHeader className="border-b border-zinc-800 pb-6">
                <CardTitle className="text-2xl font-semibold tracking-tight">
                  Upload and Index
                </CardTitle>
                <CardDescription className="max-w-2xl text-zinc-400">
                  Add a new PDF or seed the bundled OJK regulations. The backend
                  will extract text, split it into chunks, and store embeddings
                  locally in ChromaDB.
                </CardDescription>
              </CardHeader>

              <CardContent className="space-y-6 pt-6">
                <div className="grid gap-3 sm:grid-cols-3">
                  <div className="rounded-2xl border border-zinc-800 bg-zinc-900/65 p-4">
                    <p className="text-sm font-medium text-zinc-100">1. PDF input</p>
                    <p className="mt-2 text-xs leading-5 text-zinc-500">
                      Drag in one regulation or use the bundled documents to avoid
                      manual setup.
                    </p>
                  </div>
                  <div className="rounded-2xl border border-zinc-800 bg-zinc-900/65 p-4">
                    <p className="text-sm font-medium text-zinc-100">2. Local indexing</p>
                    <p className="mt-2 text-xs leading-5 text-zinc-500">
                      Chunking and vector storage happen locally, so no Pinecone
                      key is required.
                    </p>
                  </div>
                  <div className="rounded-2xl border border-zinc-800 bg-zinc-900/65 p-4">
                    <p className="text-sm font-medium text-zinc-100">3. Chat handoff</p>
                    <p className="mt-2 text-xs leading-5 text-zinc-500">
                      Once indexed, the chat page can retrieve those chunks before
                      asking Ollama or OpenRouter.
                    </p>
                  </div>
                </div>

                <label
                  htmlFor="pdf-upload"
                  className={`group flex cursor-pointer flex-col items-center justify-center rounded-[1.75rem] border-2 border-dashed border-zinc-800 bg-zinc-900/40 p-12 text-center transition-all hover:border-zinc-700 hover:bg-zinc-900 ${
                    file ? 'border-zinc-500 bg-zinc-900' : ''
                  }`}
                >
                  <UploadCloud
                    className={`mb-4 h-12 w-12 transition-colors ${
                      file
                        ? 'text-zinc-100'
                        : 'text-zinc-600 group-hover:text-zinc-400'
                    }`}
                  />
                  <p className="text-base font-medium text-zinc-200">
                    {file ? file.name : 'Click to browse or drag & drop a PDF'}
                  </p>
                  <p className="mt-2 max-w-md text-sm leading-6 text-zinc-500">
                    Text-based PDFs index best. Scanned images without OCR may not
                    produce useful chunks.
                  </p>
                  <Input
                    id="pdf-upload"
                    type="file"
                    accept=".pdf"
                    className="hidden"
                    onChange={(event) => setFile(event.target.files?.[0] || null)}
                  />
                </label>

                <div className="flex flex-col gap-3 sm:flex-row">
                  <Button
                    onClick={handleExtract}
                    disabled={!file || isUploading || isSeeding}
                    className="h-12 flex-1 rounded-full bg-zinc-100 text-zinc-900 hover:bg-zinc-200 disabled:opacity-50"
                  >
                    {isUploading ? (
                      <>
                        <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                        Indexing...
                      </>
                    ) : (
                      <>
                        Upload and Index
                        <ArrowRight className="ml-2 h-4 w-4" />
                      </>
                    )}
                  </Button>

                  <Button
                    variant="outline"
                    onClick={handleSeedDocuments}
                    disabled={isSeeding || isUploading}
                    className="h-12 flex-1 rounded-full border-zinc-700 text-zinc-300 hover:bg-zinc-900 hover:text-zinc-100"
                  >
                    {isSeeding ? (
                      <>
                        <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                        Seeding...
                      </>
                    ) : (
                      <>
                        <Sparkles className="mr-2 h-4 w-4" />
                        Seed Bundled OJK PDFs
                      </>
                    )}
                  </Button>
                </div>

                {progressState && (
                  <ActivityProgress
                    detail={progressState.detail}
                    label={progressState.label}
                    progress={progressState.progress}
                    status={progressState.status}
                  />
                )}

                {statusState && (
                  <div
                    className={`flex items-start gap-3 rounded-2xl border px-4 py-3 text-sm ${
                      statusState.tone === 'success'
                        ? 'border-emerald-900/60 bg-emerald-950/20 text-emerald-100'
                        : 'border-red-900/60 bg-red-950/20 text-red-100'
                    }`}
                  >
                    {statusState.tone === 'success' ? (
                      <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-300" />
                    ) : (
                      <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-300" />
                    )}
                    <p className="leading-6">{statusState.message}</p>
                  </div>
                )}
              </CardContent>
            </Card>

            <Card className="overflow-hidden border-zinc-800 bg-zinc-950 text-zinc-100 shadow-2xl">
              <CardHeader className="border-b border-zinc-800 pb-5">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <CardTitle className="text-xl font-semibold tracking-tight">
                      Indexed Documents
                    </CardTitle>
                    <CardDescription className="text-zinc-400">
                      {totalChunks} total chunks stored locally and ready for retrieval
                    </CardDescription>
                  </div>
                  {isRefreshing && (
                    <Loader2 className="h-4 w-4 animate-spin text-zinc-500" />
                  )}
                </div>
              </CardHeader>

              <CardContent className="p-0">
                {indexedDocuments.length === 0 ? (
                  <div className="flex flex-col items-center gap-3 px-6 py-10 text-center">
                    <div className="rounded-full border border-zinc-800 bg-zinc-900 p-3 text-zinc-400">
                      <FileText className="h-5 w-5" />
                    </div>
                    <div>
                      <p className="text-sm font-medium text-zinc-200">
                        No documents indexed yet
                      </p>
                      <p className="mt-2 max-w-md text-sm leading-6 text-zinc-500">
                        Upload one PDF or seed the bundled OJK set to populate the
                        local Chroma store.
                      </p>
                    </div>
                  </div>
                ) : (
                  <Table className="border-collapse">
                    <TableHeader>
                      <TableRow className="border-zinc-800 hover:bg-zinc-900/40">
                        <TableHead className="text-zinc-500">Document</TableHead>
                        <TableHead className="text-zinc-500">Pages</TableHead>
                        <TableHead className="text-zinc-500">Chunks</TableHead>
                        <TableHead className="text-zinc-500">New</TableHead>
                        <TableHead className="text-zinc-500">Reused</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody className="text-sm">
                      {indexedDocuments.map((document) => (
                        <TableRow
                          key={document.source}
                          className="border-zinc-800 hover:bg-zinc-900/40"
                        >
                          <TableCell className="max-w-[320px] text-zinc-200">
                            <div className="truncate">{document.source}</div>
                          </TableCell>
                          <TableCell className="text-zinc-400">
                            {document.pages}
                          </TableCell>
                          <TableCell className="text-zinc-400">
                            {document.chunks}
                          </TableCell>
                          <TableCell className="text-zinc-400">
                            {document.chunks_indexed}
                          </TableCell>
                          <TableCell className="text-zinc-400">
                            {document.chunks_skipped}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          </div>

          <WorkflowStatusPanel
            title="Check the full retrieval-to-answer path"
            status={workflowStatus}
            error={workflowError}
            isRefreshing={isRefreshing}
            onRefresh={() => {
              void refreshDashboard();
            }}
            actionHref="/rag-chat"
            actionLabel="Open Chat"
          />
        </div>
      </div>
    </div>
  );
}
