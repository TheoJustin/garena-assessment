import Link from 'next/link';
import { Button } from '@/components/ui/button';
import {
  ArrowRight,
  Bot,
  Database,
  FileText,
  Network,
  Sparkles,
} from 'lucide-react';

export default function LandingPage() {
  return (
    <div className="pb-16 pt-16">
      <div className="mx-auto max-w-6xl space-y-8 px-4 md:px-6">
        <section className="overflow-hidden rounded-[2.5rem] border border-zinc-800 bg-[radial-gradient(circle_at_top,_rgba(255,255,255,0.08),_rgba(24,24,27,0.94)_42%,_rgba(10,10,12,1)_100%)] px-6 py-10 shadow-2xl md:px-10">
          <div className="mx-auto flex max-w-4xl flex-col items-center gap-6 text-center">
            <p className="inline-flex items-center gap-2 rounded-full border border-zinc-800 bg-zinc-900/70 px-3 py-1 text-[11px] font-medium uppercase tracking-[0.22em] text-zinc-400">
              <Sparkles className="h-3.5 w-3.5" />
              Local Regulatory Copilot
            </p>
            <h1 className="text-4xl font-semibold tracking-tight text-zinc-50 sm:text-6xl">
              Turn OJK PDFs into a grounded, readable business workflow
            </h1>
            <p className="max-w-2xl text-lg leading-8 text-zinc-400">
              This copy of the app chunks regulatory PDFs locally, stores them
              in Pinecone with integrated embeddings, then uses Ollama or
              OpenRouter to explain the rules in practical business language.
            </p>
            <div className="mt-2 flex flex-wrap justify-center gap-3">
              <Link href="/upload">
                <Button className="h-12 rounded-full bg-zinc-100 px-8 text-base font-medium text-zinc-900 hover:bg-zinc-200">
                  Ingest Documents <ArrowRight className="ml-2 h-4 w-4" />
                </Button>
              </Link>
              <Link href="/rag-chat">
                <Button
                  variant="outline"
                  className="h-12 rounded-full border-zinc-700 px-8 text-base text-zinc-200 hover:bg-zinc-900"
                >
                  Ask Questions
                </Button>
              </Link>
            </div>
          </div>
        </section>

        <section className="grid gap-4 md:grid-cols-4">
          <div className="rounded-[1.75rem] border border-zinc-800/70 bg-zinc-950/35 p-6">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-zinc-900">
              <FileText className="h-6 w-6 text-zinc-400" />
            </div>
            <h3 className="mt-4 text-lg font-medium text-zinc-200">1. Ingest PDFs</h3>
            <p className="mt-2 text-sm leading-6 text-zinc-500">
              Seed the bundled OJK regulations or upload your own business and
              compliance PDFs.
            </p>
          </div>

          <div className="rounded-[1.75rem] border border-zinc-800/70 bg-zinc-950/35 p-6">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-zinc-900">
              <Database className="h-6 w-6 text-zinc-400" />
            </div>
            <h3 className="mt-4 text-lg font-medium text-zinc-200">2. Index in Pinecone</h3>
            <p className="mt-2 text-sm leading-6 text-zinc-500">
              The backend splits pages into retrieval chunks and sends them to
              Pinecone for integrated embedding and semantic search.
            </p>
          </div>

          <div className="rounded-[1.75rem] border border-zinc-800/70 bg-zinc-950/35 p-6">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-zinc-900">
              <Network className="h-6 w-6 text-zinc-400" />
            </div>
            <h3 className="mt-4 text-lg font-medium text-zinc-200">
              3. Query the Model
            </h3>
            <p className="mt-2 text-sm leading-6 text-zinc-500">
              Send only retrieved context to Ollama on your VPS or to a cheap
              OpenRouter model.
            </p>
          </div>

          <div className="rounded-[1.75rem] border border-zinc-800/70 bg-zinc-950/35 p-6">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-zinc-900">
              <Bot className="h-6 w-6 text-zinc-400" />
            </div>
            <h3 className="mt-4 text-lg font-medium text-zinc-200">
              4. Read the Answer
            </h3>
            <p className="mt-2 text-sm leading-6 text-zinc-500">
              Ask what a clause means, what changed, or what the operational
              impact is, then trace the answer back to the retrieved pages.
            </p>
          </div>
        </section>
      </div>
    </div>
  );
}
