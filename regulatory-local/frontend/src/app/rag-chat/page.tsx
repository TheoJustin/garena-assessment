'use client';

import { startTransition, useEffect, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import {
  ArrowUp,
  Bot,
  FileText,
  Loader2,
  RefreshCcw,
  Sparkles,
  User,
} from 'lucide-react';

import { ActivityProgress } from '@/components/activity-progress';
import { Button } from '@/components/ui/button';
import {
  BACKEND_URL,
  fetchJsonWithTimeout,
  isWorkflowReady,
  type WorkflowStatus,
} from '@/lib/workflow';

type SourceReference = {
  page: number;
  source: string;
};

type ChatMessage = {
  content: string;
  id: string;
  role: 'assistant' | 'user';
  sources?: SourceReference[];
};

type ChatResponse = {
  response: string;
  sources: SourceReference[];
};

const SUGGESTED_PROMPTS = [
  'What changed between POJK 62/2020 and POJK 7/2024 for BPR licensing?',
  'Explain the practical meaning of BPR and BPRS in simple business language.',
  'Which sections define the scope and permitted activities of BPR?',
];

const CHAT_STAGES = [
  {
    threshold: 0,
    label: 'Retrieving context',
    detail: 'Finding the most relevant regulatory chunks in Chroma.',
  },
  {
    threshold: 36,
    label: 'Comparing sources',
    detail: 'Checking the retrieved passages for the answer.',
  },
  {
    threshold: 72,
    label: 'Drafting explanation',
    detail: 'Writing a grounded business-facing explanation.',
  },
];

const INITIAL_ASSISTANT_MESSAGE =
  'Hello! I can explain the indexed OJK and BPR/BPRS documents in plain language. Ask about definitions, requirements, changes, or operational impact.';

function getChatStage(progress: number) {
  let activeStage = CHAT_STAGES[0];

  for (const stage of CHAT_STAGES) {
    if (progress >= stage.threshold) {
      activeStage = stage;
    }
  }

  return activeStage;
}

function createMessageId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function ChatBubble({ message }: { message: ChatMessage }) {
  const isAssistant = message.role === 'assistant';

  return (
    <div
      className={`flex w-full gap-4 ${
        isAssistant ? 'justify-start' : 'justify-end'
      }`}
    >
      {isAssistant && (
        <div className="mt-1 flex h-9 w-9 shrink-0 items-center justify-center rounded-2xl border border-zinc-800 bg-zinc-900 text-zinc-300">
          <Bot className="h-4 w-4" />
        </div>
      )}

      <div
        className={`max-w-[90%] rounded-[1.75rem] border px-5 py-4 shadow-lg ${
          isAssistant
            ? 'border-zinc-800 bg-zinc-950/90 text-zinc-100'
            : 'border-zinc-200/10 bg-zinc-100 text-zinc-900'
        }`}
      >
        <div className="chat-markdown text-[15px] leading-7">
          <ReactMarkdown
            components={{
              a: ({ children, href }) => (
                <a
                  href={href}
                  target="_blank"
                  rel="noreferrer"
                  className={
                    isAssistant
                      ? 'text-zinc-100 underline decoration-zinc-600 underline-offset-4'
                      : 'text-zinc-900 underline decoration-zinc-500 underline-offset-4'
                  }
                >
                  {children}
                </a>
              ),
              blockquote: ({ children }) => (
                <blockquote className="border-l-2 border-zinc-700/80 pl-4 text-zinc-300">
                  {children}
                </blockquote>
              ),
              code: ({ children }) => (
                <code
                  className={`rounded-md px-1.5 py-1 font-mono text-[0.82em] ${
                    isAssistant
                      ? 'bg-zinc-900 text-zinc-100'
                      : 'bg-zinc-800/10 text-zinc-900'
                  }`}
                >
                  {children}
                </code>
              ),
              li: ({ children }) => <li className="mb-1 last:mb-0">{children}</li>,
              ol: ({ children }) => (
                <ol className="my-3 ml-5 list-decimal space-y-1">{children}</ol>
              ),
              p: ({ children }) => <p className="mb-3 last:mb-0">{children}</p>,
              strong: ({ children }) => (
                <strong
                  className={isAssistant ? 'font-semibold text-zinc-50' : 'font-semibold'}
                >
                  {children}
                </strong>
              ),
              ul: ({ children }) => (
                <ul className="my-3 ml-5 list-disc space-y-1">{children}</ul>
              ),
            }}
          >
            {message.content}
          </ReactMarkdown>
        </div>

        {isAssistant && message.sources && message.sources.length > 0 && (
          <div className="mt-4 border-t border-zinc-800 pt-4">
            <p className="mb-3 text-[11px] font-medium uppercase tracking-[0.18em] text-zinc-500">
              Retrieved Sources
            </p>
            <div className="flex flex-wrap gap-2">
              {message.sources.map((source) => (
                <div
                  key={`${message.id}-${source.source}-${source.page}`}
                  className="inline-flex items-center gap-2 rounded-full border border-zinc-800 bg-zinc-900/80 px-3 py-2 text-xs text-zinc-300"
                >
                  <FileText className="h-3.5 w-3.5 text-zinc-500" />
                  <span className="max-w-56 truncate">{source.source}</span>
                  <span className="rounded-full bg-zinc-800 px-2 py-0.5 text-[11px] text-zinc-400">
                    p.{source.page}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {!isAssistant && (
        <div className="mt-1 flex h-9 w-9 shrink-0 items-center justify-center rounded-2xl border border-zinc-700 bg-zinc-900 text-zinc-300">
          <User className="h-4 w-4" />
        </div>
      )}
    </div>
  );
}

export default function RagChatPage() {
  const [input, setInput] = useState('');
  const [isRefreshingWorkflow, setIsRefreshingWorkflow] = useState(false);
  const [isThinking, setIsThinking] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      content: INITIAL_ASSISTANT_MESSAGE,
      id: createMessageId('assistant'),
      role: 'assistant',
    },
  ]);
  const [thinkingProgress, setThinkingProgress] = useState(10);
  const [workflowError, setWorkflowError] = useState<string | null>(null);
  const [workflowStatus, setWorkflowStatus] = useState<WorkflowStatus | null>(null);
  const currentStage = getChatStage(thinkingProgress);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);

  const refreshWorkflow = async () => {
    setIsRefreshingWorkflow(true);
    setWorkflowError(null);

    try {
      const status = await fetchJsonWithTimeout<WorkflowStatus>(
        `${BACKEND_URL}/workflow-status`,
        { cache: 'no-store' },
        15000,
      );
      setWorkflowStatus(status);
    } catch (error) {
      console.error('Failed to refresh workflow status', error);
      setWorkflowError(
        error instanceof Error
          ? error.message
          : 'Failed to load workflow status from the backend.',
      );
    } finally {
      setIsRefreshingWorkflow(false);
    }
  };

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      void refreshWorkflow();
    }, 0);

    return () => {
      window.clearTimeout(timeout);
    };
  }, []);

  useEffect(() => {
    if (!isThinking) return;

    const interval = window.setInterval(() => {
      setThinkingProgress((current) =>
        Math.min(90, current + Math.max(1.5, (92 - current) / 7)),
      );
    }, 320);

    return () => {
      window.clearInterval(interval);
    };
  }, [isThinking]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isThinking]);

  const appendAssistantMessage = (content: string, sources: SourceReference[] = []) => {
    startTransition(() => {
      setMessages((current) => [
        ...current,
        {
          content,
          id: createMessageId('assistant'),
          role: 'assistant',
          sources,
        },
      ]);
    });
  };

  const resetConversation = () => {
    setMessages([
      {
        content: INITIAL_ASSISTANT_MESSAGE,
        id: createMessageId('assistant'),
        role: 'assistant',
      },
    ]);
  };

  const handleMessage = async (message: string) => {
    const trimmed = message.trim();
    if (!trimmed || isThinking) return;

    startTransition(() => {
      setMessages((current) => [
        ...current,
        {
          content: trimmed,
          id: createMessageId('user'),
          role: 'user',
        },
      ]);
    });

    setInput('');
    setIsThinking(true);

    try {
      const data = await fetchJsonWithTimeout<ChatResponse>(
        '/api/rag-chat',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ message: trimmed }),
          cache: 'no-store',
        },
        70000,
      );

      appendAssistantMessage(data.response, Array.isArray(data.sources) ? data.sources : []);
    } catch (error) {
      console.error('Error communicating with RAG API:', error);
      appendAssistantMessage(
        error instanceof Error
          ? error.message
          : 'Sorry, I encountered an error searching the knowledge base.',
      );
      await refreshWorkflow();
    } finally {
      setThinkingProgress(10);
      setIsThinking(false);
    }
  };

  const submitCurrentInput = () => {
    void handleMessage(input);
  };

  const workflowReady = isWorkflowReady(workflowStatus);
  const providerLabel = workflowStatus?.provider.name
    ? workflowStatus.provider.name.charAt(0).toUpperCase() +
      workflowStatus.provider.name.slice(1)
    : 'Provider';

  return (
    <div className="min-h-[88vh] px-4 py-6 md:px-6 md:py-8">
      <div className="mx-auto max-w-5xl space-y-6">
        <section className="rounded-[2rem] border border-zinc-800 bg-[radial-gradient(circle_at_top,_rgba(255,255,255,0.08),_rgba(24,24,27,0.92)_45%,_rgba(10,10,12,1)_100%)] p-6 shadow-2xl md:p-8">
          <div className="flex flex-col gap-5 md:flex-row md:items-start md:justify-between">
            <div className="max-w-3xl">
              <p className="mb-2 inline-flex items-center gap-2 rounded-full border border-zinc-800 bg-zinc-900/70 px-3 py-1 text-[11px] font-medium uppercase tracking-[0.2em] text-zinc-400">
                <Sparkles className="h-3.5 w-3.5" />
                Grounded Regulatory Copilot
              </p>
              <h1 className="text-3xl font-semibold tracking-tight text-zinc-50 md:text-4xl">
                Ask cleaner questions and get grounded document answers
              </h1>
              <p className="mt-3 max-w-3xl text-sm leading-6 text-zinc-400 md:text-[15px]">
                The chat retrieves local Chroma chunks first, then sends only
                that context to the configured model for a business-facing
                explanation.
              </p>
            </div>

            <div className="flex items-center gap-3">
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  void refreshWorkflow();
                }}
                className="h-10 rounded-full border-zinc-700 bg-zinc-950/70 px-4 text-zinc-300 hover:bg-zinc-900 hover:text-zinc-100"
              >
                {isRefreshingWorkflow ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <RefreshCcw className="mr-2 h-4 w-4" />
                )}
                Refresh
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={resetConversation}
                className="h-10 rounded-full border-zinc-700 bg-zinc-950/70 px-4 text-zinc-300 hover:bg-zinc-900 hover:text-zinc-100"
              >
                Clear chat
              </Button>
            </div>
          </div>

          <div className="mt-5 flex flex-wrap gap-2">
            <span className="rounded-full border border-zinc-800 bg-zinc-950/80 px-3 py-1.5 text-xs text-zinc-300">
              {workflowStatus?.indexed_documents ?? 0} indexed PDF
              {(workflowStatus?.indexed_documents ?? 0) === 1 ? '' : 's'}
            </span>
            <span className="rounded-full border border-zinc-800 bg-zinc-950/80 px-3 py-1.5 text-xs text-zinc-300">
              {workflowStatus?.total_chunks ?? 0} stored chunk
              {(workflowStatus?.total_chunks ?? 0) === 1 ? '' : 's'}
            </span>
            <span className="rounded-full border border-zinc-800 bg-zinc-950/80 px-3 py-1.5 text-xs text-zinc-300">
              {providerLabel}: {workflowStatus?.provider.chat_model ?? 'Checking...'}
            </span>
          </div>

          <div className="mt-5 flex flex-wrap gap-2">
            {SUGGESTED_PROMPTS.map((prompt) => (
              <button
                key={prompt}
                type="button"
                onClick={() => setInput(prompt)}
                className="rounded-full border border-zinc-800 bg-zinc-950/80 px-4 py-2 text-left text-sm text-zinc-300 transition hover:border-zinc-700 hover:bg-zinc-900 hover:text-zinc-100"
              >
                {prompt}
              </button>
            ))}
          </div>
        </section>

        {isThinking && (
          <ActivityProgress
            detail={currentStage.detail}
            label={currentStage.label}
            progress={thinkingProgress}
            status="active"
          />
        )}

        {workflowError && (
          <div className="rounded-[1.5rem] border border-red-900/60 bg-red-950/20 px-5 py-4 text-sm text-red-100">
            <p className="leading-6">{workflowError}</p>
          </div>
        )}

        {!workflowReady && (
          <div className="rounded-[1.5rem] border border-amber-900/60 bg-amber-950/20 px-5 py-4 text-sm text-amber-100">
            <p className="font-medium">Workflow not ready yet</p>
            <p className="mt-2 leading-6">
              {workflowStatus?.recommended_next_action ??
                'Index at least one PDF and verify the provider before using the chat.'}
            </p>
          </div>
        )}

        <div className="overflow-hidden rounded-[2rem] border border-zinc-800 bg-zinc-950 shadow-2xl">
          <div className="border-b border-zinc-800 bg-zinc-950/90 px-6 py-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-lg font-medium text-zinc-100">
                  Regulatory Conversation
                </h2>
                <p className="text-sm text-zinc-500">
                  Answers cite retrieved PDF chunks and avoid freeform guessing.
                </p>
              </div>
              <div className="rounded-full border border-zinc-800 bg-zinc-900/80 px-3 py-1 text-xs text-zinc-400">
                {messages.length - 1} message
                {messages.length - 1 === 1 ? '' : 's'}
              </div>
            </div>
          </div>

          <div className="max-h-[62vh] overflow-y-auto bg-[linear-gradient(180deg,rgba(24,24,27,0.65),rgba(10,10,12,0.92))] px-4 py-5 md:px-6">
            <div className="space-y-5">
              {messages.map((message) => (
                <ChatBubble key={message.id} message={message} />
              ))}

              {isThinking && (
                <div className="flex gap-4">
                  <div className="mt-1 flex h-9 w-9 shrink-0 items-center justify-center rounded-2xl border border-zinc-800 bg-zinc-900 text-zinc-300">
                    <Bot className="h-4 w-4" />
                  </div>
                  <div className="inline-flex items-center gap-3 rounded-3xl border border-zinc-800 bg-zinc-950/80 px-5 py-4 text-sm text-zinc-400">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Thinking through the retrieved sections...
                  </div>
                </div>
              )}

              <div ref={messagesEndRef} />
            </div>
          </div>

          <div className="border-t border-zinc-800 bg-zinc-950/95 p-4 md:p-5">
            <div className="rounded-[1.75rem] border border-zinc-800 bg-zinc-900/70 p-3 shadow-inner">
              <textarea
                value={input}
                onChange={(event) => setInput(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && !event.shiftKey) {
                    event.preventDefault();
                    submitCurrentInput();
                  }
                }}
                placeholder={
                  workflowReady
                    ? 'Ask what changed, what a clause means, or what the operational impact is...'
                    : 'Ask anyway if you want. The backend will tell us whether indexing or provider setup still needs attention.'
                }
                className="min-h-[92px] w-full resize-none bg-transparent px-3 py-2 text-[15px] leading-7 text-zinc-100 outline-none placeholder:text-zinc-500 disabled:text-zinc-500"
                disabled={isThinking}
              />

              <div className="flex flex-wrap items-center justify-between gap-3 border-t border-zinc-800 px-2 pt-3">
                <p className="text-xs leading-5 text-zinc-500">
                  `Enter` sends. `Shift + Enter` adds a new line.
                </p>
                <Button
                  type="button"
                  onClick={submitCurrentInput}
                  disabled={!input.trim() || isThinking}
                  className="h-11 rounded-full bg-zinc-100 px-5 text-zinc-900 hover:bg-zinc-200"
                >
                  Send
                  <ArrowUp className="ml-2 h-4 w-4" />
                </Button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
