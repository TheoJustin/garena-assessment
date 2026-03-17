'use client';

import { useChat } from '@ai-sdk/react';
import { useEffect, useRef, useState } from 'react';
import { DefaultChatTransport, type UIMessage, type ToolUIPart } from 'ai';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from '@/components/ui/card';
import { Send, Loader2, Bot, User, Database } from 'lucide-react';

type QueryPostgresInput = { query: string };
type QueryPostgresOutput = Record<string, unknown>[] | { error: string };

type QueryPostgresToolPart = ToolUIPart<{
  query_postgres: {
    input: QueryPostgresInput;
    output: QueryPostgresOutput;
  };
}>;

// Derive the possible part states from the type itself — no magic strings
type ToolPartState = QueryPostgresToolPart['state'];

const RUNNING_STATES: ToolPartState[] = ['input-streaming', 'input-available'];

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function QueryPostgresPart({ part }: { part: QueryPostgresToolPart }) {
  const isRunning = RUNNING_STATES.includes(part.state);

  return (
    <div className="mb-2 flex items-center gap-2 rounded border border-zinc-800 bg-zinc-950 px-3 py-2 font-mono text-xs text-zinc-500">
      {isRunning ? (
        <>
          <Loader2 className="mr-2 h-3 w-3 animate-spin" />
          Executing SQL query...
        </>
      ) : (
        <>
          <Database className="mr-2 h-3 w-3" />
          Query complete. Reading data...
        </>
      )}
    </div>
  );
}

function ChatMessage({ message }: { message: UIMessage }) {
  const isUser = message.role === 'user';

  return (
    <div className={`flex gap-4 ${isUser ? 'justify-end' : 'justify-start'}`}>
      {!isUser && (
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-zinc-700 bg-zinc-800">
          <Bot className="h-4 w-4 text-zinc-300" />
        </div>
      )}

      <div
        className={`max-w-[80%] rounded-xl px-4 py-3 text-sm leading-relaxed ${
          isUser
            ? 'bg-zinc-100 text-zinc-900'
            : 'border border-zinc-800 bg-zinc-900 text-zinc-300'
        }`}
      >
        {message.parts.map((part, index) => {
          if (part.type === 'text') {
            return (
              <span key={index} className="whitespace-pre-wrap">
                {part.text}
              </span>
            );
          }

          // ✅ Narrow via the discriminant, then cast to the typed part
          if (part.type === 'tool-query_postgres') {
            return (
              <QueryPostgresPart
                key={index}
                part={part as QueryPostgresToolPart}
              />
            );
          }

          return null;
        })}
      </div>

      {isUser && (
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-zinc-700 bg-zinc-800">
          <User className="h-4 w-4 text-zinc-300" />
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function ChatPage() {
  const [input, setInput] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const { messages, sendMessage, status } = useChat({
    transport: new DefaultChatTransport({ api: '/api/chat' }),
  });

  const isLoading = status === 'submitted' || status === 'streaming';
  const lastMessage = messages.at(-1);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!input.trim() || isLoading) return;
    sendMessage({ text: input });
    setInput('');
  }

  return (
    <div className="flex min-h-[85vh] items-center justify-center p-4">
      <Card
        className="flex w-full max-w-4xl flex-col overflow-hidden border-zinc-800 bg-zinc-950 text-zinc-100 shadow-xl"
        style={{ height: '80vh' }}
      >
        <CardHeader className="border-b border-zinc-800 bg-zinc-900/50 pb-6 text-center">
          <CardTitle className="flex items-center justify-center gap-2 text-2xl font-semibold tracking-tight">
            <Database className="h-6 w-6 text-zinc-400" />
            NL-to-SQL Assistant
          </CardTitle>
          <CardDescription className="text-zinc-400">
            Ask questions about your competitors in plain language.
          </CardDescription>
        </CardHeader>

        <CardContent className="flex-1 space-y-6 overflow-y-auto bg-zinc-950/50 p-6">
          {messages.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center text-zinc-500">
              <Bot className="mb-4 h-12 w-12 text-zinc-700" />
              <p>Try asking:</p>
              <p className="mt-2 px-4 text-center text-sm italic">
                "Which competitors offer an 'AI Dashboard' feature priced under
                $50?"
              </p>
            </div>
          ) : (
            messages.map((m) => <ChatMessage key={m.id} message={m} />)
          )}

          {isLoading && lastMessage?.role === 'user' && (
            <div className="flex justify-start gap-4">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-zinc-700 bg-zinc-800">
                <Bot className="h-4 w-4 text-zinc-300" />
              </div>
              <div className="flex max-w-[80%] items-center rounded-xl border border-zinc-800 bg-zinc-900 px-4 py-3 text-sm text-zinc-400">
                <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Thinking...
              </div>
            </div>
          )}

          <div ref={messagesEndRef} />
        </CardContent>

        <div className="border-t border-zinc-800 bg-zinc-900/50 p-4">
          <form
            onSubmit={handleSubmit}
            className="relative flex w-full items-center"
          >
            <Input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Ask about your competitor data..."
              className="h-12 w-full rounded-full border-zinc-700 bg-zinc-950 pl-6 pr-14 text-zinc-200 placeholder:text-zinc-500 focus-visible:ring-zinc-600"
              disabled={isLoading}
            />
            <Button
              type="submit"
              disabled={isLoading || !input.trim()}
              size="icon"
              className="absolute right-1.5 h-9 w-9 rounded-full bg-zinc-100 text-zinc-900 hover:bg-zinc-200 disabled:opacity-50"
            >
              <Send className="h-4 w-4" />
            </Button>
          </form>
        </div>
      </Card>
    </div>
  );
}
