'use client';

import { useEffect, useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  Loader2,
  Sparkles,
  UploadCloud,
} from 'lucide-react';

import { ActivityProgress } from '@/components/activity-progress';
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

const BACKEND_URL =
  process.env.NEXT_PUBLIC_BACKEND_URL ?? 'http://localhost:8001';

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

    xhr.upload.onprogress = (event) => {
      if (!event.lengthComputable) return;

      const uploadShare = (event.loaded / event.total) * 32;
      onProgress(uploadShare);
    };

    xhr.upload.onload = () => {
      onUploadComplete();
    };

    xhr.onerror = () => {
      reject(new Error('Network error during upload.'));
    };

    xhr.onload = () => {
      const response = xhr.response as IngestionResponse;
      const errorResponse = xhr.response as { detail?: string } | null;

      if (xhr.status >= 200 && xhr.status < 300) {
        resolve(response);
        return;
      }

      reject(
        new Error(
          errorResponse?.detail ??
            'The backend rejected the uploaded document.',
        ),
      );
    };

    xhr.send(formData);
  });
}

export default function UploadPage() {
  const [file, setFile] = useState<File | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [isSeeding, setIsSeeding] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [indexedDocuments, setIndexedDocuments] = useState<IndexedDocument[]>(
    [],
  );
  const [totalChunks, setTotalChunks] = useState(0);
  const [statusState, setStatusState] = useState<StatusState | null>(null);
  const [progressState, setProgressState] = useState<ProgressState | null>(
    null,
  );
  const [shouldAutoAdvance, setShouldAutoAdvance] = useState(false);

  const refreshDocuments = async () => {
    setIsRefreshing(true);
    try {
      const response = await fetch(`${BACKEND_URL}/documents`, {
        cache: 'no-store',
      });
      if (!response.ok) {
        throw new Error('Failed to load indexed documents.');
      }

      const data: DocumentsResponse = await response.json();
      setIndexedDocuments(data.documents);
      setTotalChunks(data.total_chunks);
    } catch (error) {
      console.error('Failed to refresh indexed documents', error);
    } finally {
      setIsRefreshing(false);
    }
  };

  useEffect(() => {
    let cancelled = false;

    const loadDocuments = async () => {
      setIsRefreshing(true);
      try {
        const response = await fetch(`${BACKEND_URL}/documents`, {
          cache: 'no-store',
        });
        if (!response.ok) {
          throw new Error('Failed to load indexed documents.');
        }

        const data: DocumentsResponse = await response.json();
        if (cancelled) return;
        setIndexedDocuments(data.documents);
        setTotalChunks(data.total_chunks);
      } catch (error) {
        console.error('Failed to refresh indexed documents', error);
      } finally {
        if (!cancelled) {
          setIsRefreshing(false);
        }
      }
    };

    void loadDocuments();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!progressState || !shouldAutoAdvance || progressState.status !== 'active')
      return;

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
      await refreshDocuments();
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

      if (!response.ok) {
        throw new Error('Bundled document ingestion failed.');
      }

      const data: IngestionResponse = await response.json();
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
      await refreshDocuments();
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
    <div className="flex min-h-[85vh] items-center justify-center p-4">
      <Card className="w-full max-w-4xl border-zinc-800 bg-zinc-950 text-zinc-100 shadow-xl">
        <CardHeader className="border-b border-zinc-800 pb-6 text-center">
          <CardTitle className="text-2xl font-semibold tracking-tight">
            Upload Regulatory Documents
          </CardTitle>
          <CardDescription className="text-zinc-400">
            Ingest PDFs into a local Chroma database, or seed the bundled OJK
            regulations that already ship with this folder.
          </CardDescription>
        </CardHeader>

        <CardContent className="pt-6">
          <div className="grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
            <div className="flex flex-col gap-6">
              <label
                htmlFor="pdf-upload"
                className={`group flex cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed border-zinc-800 bg-zinc-900/50 p-16 transition-all hover:bg-zinc-900 ${
                  file ? 'border-zinc-500 bg-zinc-900' : ''
                }`}
              >
                <UploadCloud
                  className={`mb-4 h-12 w-12 transition-colors ${file ? 'text-zinc-100' : 'text-zinc-600 group-hover:text-zinc-400'}`}
                />
                <p className="text-base font-medium text-zinc-300">
                  {file ? file.name : 'Click to browse or drag & drop'}
                </p>
                <p className="mt-2 text-xs text-zinc-500">
                  Upload a text-based PDF to index it locally
                </p>
                <Input
                  id="pdf-upload"
                  type="file"
                  accept=".pdf"
                  className="hidden"
                  onChange={(e) => setFile(e.target.files?.[0] || null)}
                />
              </label>

              <div className="flex flex-col gap-3 sm:flex-row">
                <Button
                  onClick={handleExtract}
                  disabled={!file || isUploading || isSeeding}
                  className="h-12 flex-1 bg-zinc-100 text-zinc-900 hover:bg-zinc-200 disabled:opacity-50"
                >
                  {isUploading ? (
                    <>
                      <Loader2 className="mr-2 h-5 w-5 animate-spin" />{' '}
                      Indexing...
                    </>
                  ) : (
                    'Upload and Index'
                  )}
                </Button>
                <Button
                  variant="outline"
                  onClick={handleSeedDocuments}
                  disabled={isSeeding || isUploading}
                  className="h-12 flex-1 border-zinc-700 text-zinc-300 hover:bg-zinc-900 hover:text-zinc-100"
                >
                  {isSeeding ? (
                    <>
                      <Loader2 className="mr-2 h-5 w-5 animate-spin" />{' '}
                      Seeding...
                    </>
                  ) : (
                    <>
                      <Sparkles className="mr-2 h-4 w-4" /> Seed Bundled OJK
                      PDFs
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
                  className={`flex items-start gap-3 rounded-lg border px-4 py-3 text-sm ${
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
                  {statusState.message}
                </div>
              )}
            </div>

            <div className="rounded-lg border border-zinc-800 bg-zinc-900 overflow-hidden">
              <div className="flex items-center justify-between border-b border-zinc-800 px-4 py-3">
                <div>
                  <h2 className="text-sm font-medium text-zinc-200">
                    Indexed Documents
                  </h2>
                  <p className="text-xs text-zinc-500">
                    {totalChunks} total chunks stored locally
                  </p>
                </div>
                {isRefreshing && (
                  <Loader2 className="h-4 w-4 animate-spin text-zinc-500" />
                )}
              </div>

              {indexedDocuments.length === 0 ? (
                <div className="px-4 py-6 text-sm text-zinc-500">
                  No documents indexed yet.
                </div>
              ) : (
                <Table className="border-collapse">
                  <TableHeader>
                    <TableRow className="border-zinc-800 hover:bg-zinc-900/50">
                      <TableHead className="text-zinc-500">Document</TableHead>
                      <TableHead className="text-zinc-500">Pages</TableHead>
                      <TableHead className="text-zinc-500">Chunks</TableHead>
                      <TableHead className="text-zinc-500">New</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody className="text-sm">
                    {indexedDocuments.map((doc) => (
                      <TableRow
                        key={doc.source}
                        className="border-zinc-800 hover:bg-zinc-900/50"
                      >
                        <TableCell className="text-zinc-300">
                          {doc.source}
                        </TableCell>
                        <TableCell className="text-zinc-400">
                          {doc.pages}
                        </TableCell>
                        <TableCell className="text-zinc-400">
                          {doc.chunks}
                        </TableCell>
                        <TableCell className="text-zinc-400">
                          {doc.chunks_indexed}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
