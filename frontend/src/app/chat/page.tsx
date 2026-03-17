import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Send } from 'lucide-react';

export default function ChatPage() {
  return (
    <div className="flex h-[80vh] flex-col gap-4">
      {/* Chat History Area */}
      <div className="flex-1 overflow-y-auto rounded-xl border border-zinc-800 bg-zinc-950/30 p-6 shadow-sm">
        <div className="flex flex-col gap-6">
          {/* AI Message */}
          <div className="flex w-max max-w-[85%] flex-col gap-2 rounded-2xl rounded-tl-sm bg-zinc-900 px-5 py-3 text-sm text-zinc-300">
            Hello! I've successfully processed your PDF. What would you like to
            know about it?
          </div>

          {/* User Message */}
          <div className="flex w-max max-w-[85%] self-end flex-col gap-2 rounded-2xl rounded-tr-sm bg-zinc-100 px-5 py-3 text-sm text-zinc-900">
            Can you give me a brief summary of the main arguments?
          </div>
        </div>
      </div>

      {/* Input Area */}
      <div className="flex items-center gap-3">
        <Input
          placeholder="Ask a question about your document..."
          className="h-12 flex-1 rounded-full border-zinc-800 bg-zinc-950 px-6 focus-visible:ring-1 focus-visible:ring-zinc-700"
        />
        <Button
          size="icon"
          className="h-12 w-12 shrink-0 rounded-full bg-zinc-100 text-zinc-900 hover:bg-zinc-200"
        >
          <Send className="h-5 w-5 ml-[-2px]" />
          <span className="sr-only">Send message</span>
        </Button>
      </div>
    </div>
  );
}
