'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { UploadCloud, Loader2 } from 'lucide-react';

export default function UploadPage() {
  const [file, setFile] = useState<File | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const router = useRouter();

  const handleUpload = async () => {
    if (!file) return;

    setIsUploading(true);
    const formData = new FormData();
    formData.append('file', file);

    try {
      const response = await fetch('/api/process-pdf', {
        method: 'POST',
        body: formData,
      });

      if (response.ok) {
        const data = await response.json();
        console.log('Generated SQL:', data.sql);
        // You can save this to your database or context here
        // router.push('/chat');
      }
    } catch (error) {
      console.error('Upload failed', error);
    } finally {
      setIsUploading(false);
    }
  };

  return (
    <div className="flex h-[75vh] items-center justify-center">
      <Card className="w-full max-w-md border-zinc-800 bg-zinc-950/50 shadow-none">
        <CardHeader className="text-center">
          <CardTitle className="text-xl text-zinc-100">
            Upload Document
          </CardTitle>
          <CardDescription className="text-zinc-500">
            Select a PDF to parse into the SQL database.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-6">
          <label
            htmlFor="pdf-upload"
            className={`flex cursor-pointer flex-col items-center justify-center rounded-xl border border-dashed border-zinc-800 p-12 transition-colors hover:bg-zinc-900/50 ${file ? 'bg-zinc-900/50 border-zinc-500' : ''}`}
          >
            <UploadCloud className="mb-4 h-8 w-8 text-zinc-500" />
            <p className="text-sm font-medium text-zinc-400">
              {file ? file.name : 'Click to browse or drag & drop'}
            </p>
            <p className="mt-1 text-xs text-zinc-600">PDF up to 10MB</p>
            <Input
              id="pdf-upload"
              type="file"
              accept=".pdf"
              className="hidden"
              onChange={(e) => setFile(e.target.files?.[0] || null)}
            />
          </label>

          <Button
            onClick={handleUpload}
            disabled={!file || isUploading}
            className="w-full bg-zinc-100 text-zinc-900 hover:bg-zinc-200 disabled:opacity-50"
          >
            {isUploading ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Processing...
              </>
            ) : (
              'Extract to SQL & Continue'
            )}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
