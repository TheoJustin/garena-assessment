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
    const rawText = await upstream.text();
    const data = rawText.trim() ? JSON.parse(rawText) : {};

    if (!upstream.ok) {
      return NextResponse.json(
        {
          error: 'Failed to process your question',
          details: data.detail ?? data.error ?? 'Unknown backend error',
        },
        { status: upstream.status },
      );
    }

    return NextResponse.json({
      response: data.response,
      sources: Array.isArray(data.sources) ? data.sources : [],
    });
  } catch (error) {
    console.error('RAG chat error:', error);
    return NextResponse.json(
      {
        error: 'Failed to process your question',
        details:
          error instanceof Error
            ? error.message
            : 'Unknown chat proxy error',
      },
      { status: 500 },
    );
  }
}
