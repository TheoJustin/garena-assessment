// src/app/api/rag-chat/route.ts
import { NextResponse } from 'next/server';
import { Pinecone } from '@pinecone-database/pinecone';
import { OpenAIEmbeddings } from '@langchain/openai';
import { PineconeStore } from '@langchain/pinecone';
import OpenAI from 'openai';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// Singleton — reuse across requests
let vectorStore: PineconeStore | null = null;

async function getVectorStore(): Promise<PineconeStore> {
  if (vectorStore) return vectorStore;

  const pinecone = new Pinecone({ apiKey: process.env.PINECONE_API_KEY! });
  const index = pinecone.Index(process.env.PINECONE_INDEX!);

  vectorStore = await PineconeStore.fromExistingIndex(
    new OpenAIEmbeddings({ model: 'text-embedding-3-small' }),
    { pineconeIndex: index },
  );

  return vectorStore;
}

export async function POST(req: Request) {
  try {
    const { message }: { message: string } = await req.json();

    if (!message?.trim()) {
      return NextResponse.json(
        { error: 'No message provided' },
        { status: 400 },
      );
    }

    // 1. Retrieve top-5 most relevant chunks from Pinecone
    const store = await getVectorStore();
    const results = await store.similaritySearch(message, 5);

    if (results.length === 0) {
      return NextResponse.json({
        response:
          "I couldn't find any relevant information in the uploaded documents. Try uploading some competitor PDFs first.",
      });
    }

    // 2. Build context from retrieved chunks
    const context = results
      .map(
        (doc, i) =>
          `[Source ${i + 1}: ${doc.metadata.source ?? 'unknown'}]\n${doc.pageContent}`,
      )
      .join('\n\n---\n\n');

    // 3. Call OpenAI with context + user question
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o',
      temperature: 0,
      messages: [
        {
          role: 'system',
          content: `You are a helpful competitor analysis assistant. Answer the user's question strictly based on the provided document context. If the answer is not in the context, say so clearly instead of guessing.

Document context:
${context}`,
        },
        {
          role: 'user',
          content: message,
        },
      ],
    });

    const response =
      completion.choices[0]?.message?.content ??
      'Sorry, I was unable to generate a response.';

    return NextResponse.json({ response });
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
