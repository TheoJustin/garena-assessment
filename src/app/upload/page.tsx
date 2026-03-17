import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { UploadCloud } from 'lucide-react';

export default function UploadPage() {
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
            className="flex cursor-pointer flex-col items-center justify-center rounded-xl border border-dashed border-zinc-800 p-12 transition-colors hover:bg-zinc-900/50"
          >
            <UploadCloud className="mb-4 h-8 w-8 text-zinc-500" />
            <p className="text-sm font-medium text-zinc-400">
              Click to browse or drag & drop
            </p>
            <p className="mt-1 text-xs text-zinc-600">PDF up to 10MB</p>
            <Input
              id="pdf-upload"
              type="file"
              accept=".pdf"
              className="hidden"
            />
          </label>
          <Link href="/chat" className="w-full">
            <Button className="w-full bg-zinc-100 text-zinc-900 hover:bg-zinc-200">
              Extract to SQL & Continue
            </Button>
          </Link>
        </CardContent>
      </Card>
    </div>
  );
}
