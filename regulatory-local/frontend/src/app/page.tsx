import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { FileText, Database, Bot, ArrowRight } from 'lucide-react';

export default function LandingPage() {
  return (
    <div className="flex flex-col items-center justify-center pt-24 pb-16 text-center">
      <div className="flex max-w-3xl flex-col items-center gap-6">
        <h1 className="text-4xl font-semibold tracking-tight text-zinc-50 sm:text-6xl">
          Turn OJK PDFs into a{' '}
          <span className="text-zinc-500">local regulatory copilot</span>
        </h1>
        <p className="max-w-xl text-lg text-zinc-400">
          This copy of the app is tuned for business and compliance work. It
          ingests regulatory PDFs into a local Chroma store, then uses an
          OpenRouter model to explain the rules in plain language.
        </p>
        <div className="mt-4 flex gap-4">
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

      <div className="mt-32 grid w-full max-w-4xl grid-cols-1 gap-8 sm:grid-cols-3">
        <div className="flex flex-col items-center gap-4 rounded-2xl border border-zinc-800/50 bg-zinc-950/20 p-8 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-zinc-900">
            <FileText className="h-6 w-6 text-zinc-400" />
          </div>
          <h3 className="text-lg font-medium text-zinc-200">1. Ingest PDFs</h3>
          <p className="text-sm text-zinc-500">
            Seed the bundled OJK regulations or upload your own business and
            compliance PDFs.
          </p>
        </div>

        <div className="flex flex-col items-center gap-4 rounded-2xl border border-zinc-800/50 bg-zinc-950/20 p-8 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-zinc-900">
            <Database className="h-6 w-6 text-zinc-400" />
          </div>
          <h3 className="text-lg font-medium text-zinc-200">
            2. Store Locally
          </h3>
          <p className="text-sm text-zinc-500">
            Chunks are embedded and stored in a local Chroma database so you do
            not need Pinecone.
          </p>
        </div>

        <div className="flex flex-col items-center gap-4 rounded-2xl border border-zinc-800/50 bg-zinc-950/20 p-8 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-zinc-900">
            <Bot className="h-6 w-6 text-zinc-400" />
          </div>
          <h3 className="text-lg font-medium text-zinc-200">
            3. Ask for Explanations
          </h3>
          <p className="text-sm text-zinc-500">
            Ask what a rule means, what changed, or what the operational impact
            is for BPR and BPRS teams.
          </p>
        </div>
      </div>
    </div>
  );
}
