import { NextResponse } from 'next/server';

const BACKEND_URL =
  process.env.BACKEND_URL ??
  process.env.NEXT_PUBLIC_BACKEND_URL ??
  'http://localhost:8001';

export async function POST(req: Request) {
  try {
    const { message }: { message: string } = await req.json();

    if (!message?.trim()) {
      return NextResponse.json(
        { error: 'No message provided' },
        { status: 400 },
      );
    }

    const upstream = await fetch(`${BACKEND_URL}/rag-chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message }),
      cache: 'no-store',
    });

    const data = await upstream.json();

    if (!upstream.ok) {
      return NextResponse.json(
        {
          error: 'Failed to process your question',
          details: data.detail ?? data.error ?? 'Unknown backend error',
        },
        { status: upstream.status },
      );
    }

    const sourceFooter =
      Array.isArray(data.sources) && data.sources.length > 0
        ? `\n\nSources:\n${data.sources
            .map(
              (source: { source: string; page: number }) =>
                `- ${source.source} (page ${source.page})`,
            )
            .join('\n')}`
        : '';

    return NextResponse.json({ response: `${data.response}${sourceFooter}` });
  } catch (error) {
    console.error('RAG chat error:', error);
    return NextResponse.json(
      {
        error: 'Failed to process your question',
        details: (error as Error).message,
      },
      { status: 500 },
    );
  }
}
