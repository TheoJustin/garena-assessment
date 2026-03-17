'use client';

import { useState } from 'react';
import { ChatbotRagWidget } from '@theojustin/chatbot-rag-widget';
import { Loader2 } from 'lucide-react';

export default function RagChatPage() {
  const [isThinking, setIsThinking] = useState(false);

  const handleMessage = async (message: string): Promise<string> => {
    setIsThinking(true);
    try {
      const response = await fetch('/api/rag-chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message }),
      });

      const data = await response.json();
      return data.response;
    } catch (error) {
      console.error('Error communicating with RAG API:', error);
      return 'Sorry, I encountered an error searching the knowledge base.';
    } finally {
      setIsThinking(false);
    }
  };

  return (
    <div className="flex min-h-[85vh] flex-col items-center justify-center p-8">
      <div className="w-full max-w-2xl text-center mb-8">
        <h1 className="text-3xl font-semibold tracking-tight text-zinc-100">
          Competitor Document Q&A
        </h1>
        <p className="mt-2 text-zinc-400">
          Click the icon below to ask specific questions about the uploaded
          competitor PDFs and Markdown files.
        </p>
      </div>

      {/* Loading indicator — sits above the widget */}
      {isThinking && (
        <div className="mb-3 flex items-center gap-2 text-sm text-zinc-400">
          <Loader2 className="h-4 w-4 animate-spin" />
          Searching knowledge base...
        </div>
      )}

      {/* max-w + w-full keeps it from blowing out on long responses */}
      <div className="w-full max-w-2xl overflow-hidden">
        <ChatbotRagWidget
          onSendMessage={handleMessage}
          title="RAG Assistant"
          placeholder="e.g., How loyal are core Strategy players compared to other genres?"
          initialMessage="Hello! I have read all the competitor documents. What would you like to know?"
        />
      </div>
    </div>
  );
}
