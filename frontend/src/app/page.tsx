import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { FileText, Database, Bot, ArrowRight } from 'lucide-react';

export default function LandingPage() {
  return (
    <div className="flex flex-col items-center justify-center pt-24 pb-16 text-center">
      {/* Hero Section */}
      <div className="flex max-w-3xl flex-col items-center gap-6">
        <h1 className="text-4xl font-semibold tracking-tight text-zinc-50 sm:text-6xl">
          Chat with your PDFs via{' '}
          <span className="text-zinc-500">Structured SQL</span>
        </h1>
        <p className="max-w-xl text-lg text-zinc-400">
          Upload your documents and let our engine parse them directly into a
          relational database. Our LLM agent translates your natural language
          questions into precise SQL queries for perfectly accurate answers.
        </p>
        <div className="mt-4 flex gap-4">
          <Link href="/upload">
            <Button className="h-12 rounded-full bg-zinc-100 px-8 text-base font-medium text-zinc-900 hover:bg-zinc-200">
              Get Started <ArrowRight className="ml-2 h-4 w-4" />
            </Button>
          </Link>
        </div>
      </div>

      {/* How it works pipeline */}
      <div className="mt-32 grid w-full max-w-4xl grid-cols-1 gap-8 sm:grid-cols-3">
        <div className="flex flex-col items-center gap-4 rounded-2xl border border-zinc-800/50 bg-zinc-950/20 p-8 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-zinc-900">
            <FileText className="h-6 w-6 text-zinc-400" />
          </div>
          <h3 className="text-lg font-medium text-zinc-200">1. Upload PDF</h3>
          <p className="text-sm text-zinc-500">
            Securely upload your structured reports, competitors in PDF
            format.
          </p>
        </div>

        <div className="flex flex-col items-center gap-4 rounded-2xl border border-zinc-800/50 bg-zinc-950/20 p-8 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-zinc-900">
            <Database className="h-6 w-6 text-zinc-400" />
          </div>
          <h3 className="text-lg font-medium text-zinc-200">2. Parse to SQL</h3>
          <p className="text-sm text-zinc-500">
            Our extractor identifies markdown format, transforming the
            unstructured PDF data into a relational SQL schema.
          </p>
        </div>

        <div className="flex flex-col items-center gap-4 rounded-2xl border border-zinc-800/50 bg-zinc-950/20 p-8 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-zinc-900">
            <Bot className="h-6 w-6 text-zinc-400" />
          </div>
          <h3 className="text-lg font-medium text-zinc-200">
            3. Query with LLM
          </h3>
          <p className="text-sm text-zinc-500">
            Ask questions, The LLM agent writes and executes
            SQL queries against your specific document's database.
          </p>
        </div>
      </div>
    </div>
  );
}
