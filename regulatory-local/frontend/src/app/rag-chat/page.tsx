'use client';

import { useEffect, useState } from 'react';
import { ChatbotRagWidget } from '@theojustin/chatbot-rag-widget';

import { ActivityProgress } from '@/components/activity-progress';

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

function getChatStage(progress: number) {
  let activeStage = CHAT_STAGES[0];

  for (const stage of CHAT_STAGES) {
    if (progress >= stage.threshold) {
      activeStage = stage;
    }
  }

  return activeStage;
}

export default function RagChatPage() {
  const [isThinking, setIsThinking] = useState(false);
  const [thinkingProgress, setThinkingProgress] = useState(10);
  const currentStage = getChatStage(thinkingProgress);

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

  const handleMessage = async (message: string): Promise<string> => {
    setIsThinking(true);
    try {
      const response = await fetch('/api/rag-chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message }),
      });

      const data = await response.json();
      if (!response.ok) {
        return data.details ?? 'Sorry, I encountered an error searching the knowledge base.';
      }

      return data.response;
    } catch (error) {
      console.error('Error communicating with RAG API:', error);
      return 'Sorry, I encountered an error searching the knowledge base.';
    } finally {
      setThinkingProgress(10);
      setIsThinking(false);
    }
  };

  return (
    <div className="flex min-h-[85vh] flex-col items-center justify-center p-8">
      <div className="w-full max-w-2xl text-center mb-8">
        <h1 className="text-3xl font-semibold tracking-tight text-zinc-100">
          Regulatory Document Q&A
        </h1>
        <p className="mt-2 text-zinc-400">
          Ask what a rule means, what changed, or what a requirement implies
          for a business team. Answers stay grounded in the indexed PDFs.
        </p>
      </div>

      {isThinking && (
        <div className="mb-3 w-full max-w-2xl">
          <ActivityProgress
            detail={currentStage.detail}
            label={currentStage.label}
            progress={thinkingProgress}
          />
        </div>
      )}

      <div className="w-full max-w-2xl overflow-hidden">
        <ChatbotRagWidget
          onSendMessage={handleMessage}
          title="Regulatory Copilot"
          placeholder="e.g., What changed between POJK 62/2020 and POJK 7/2024 for BPR licensing?"
          initialMessage="Hello! I can explain the indexed OJK and BPR/BPRS documents in plain language. What would you like to know?"
        />
      </div>
    </div>
  );
}
