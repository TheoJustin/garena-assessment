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
  CardFooter,
} from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { UploadCloud, Loader2, Database, X, Check } from 'lucide-react';

export default function UploadPage() {
  const [file, setFile] = useState<File | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [generatedSql, setGeneratedSql] = useState<string | null>(null);
  const [parsedSqlLines, setParsedSqlLines] = useState<string[]>([]);
  const router = useRouter();

  // Helper function to split the long SQL string into individual lines
  // This uses a regex to split after each complete ');' followed by a newline
  const parseSqlToLines = (sql: string): string[] => {
    // Split by the pattern ');' and a newline, then filter out empty lines.
    // We add ');' back to the end of each statement for completeness.
    return sql
      .split(/\);\s*\n/g)
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
      .map((line) => line + ');');
  };

  // Step 1: Send PDF to Python to get the SQL
  const handleExtract = async () => {
    if (!file) return;

    setIsUploading(true);
    const formData = new FormData();
    formData.append('file', file);

    try {
      const response = await fetch('http://localhost:8000/process-pdf', {
        method: 'POST',
        body: formData,
      });

      if (response.ok) {
        const data = await response.json();
        setGeneratedSql(data.sql);
        // Call the parser to turn the text into an array of strings
        setParsedSqlLines(parseSqlToLines(data.sql));
      } else {
        console.error('Extraction failed');
      }
    } catch (error) {
      console.error('Upload failed', error);
    } finally {
      setIsUploading(false);
    }
  };

  // Step 2: Confirm and send SQL to Postgres Docker via Next.js API
  const handleConfirmSubmit = async () => {
    if (!generatedSql) return;

    setIsSubmitting(true);
    try {
      console.log('Submitting to Postgres via API...');

      const response = await fetch('/api/execute-sql', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sql: generatedSql }),
      });

      if (response.ok) {
        // Success! Move to the chat interface
        router.push('/chat');
      } else {
        const errorData = await response.json();
        console.error('SQL Execution failed:', errorData);
        alert(`Failed to execute SQL: ${errorData.details || errorData.error}`);
      }
    } catch (error) {
      console.error('Database insertion failed', error);
      alert('Network error while trying to reach the database endpoint.');
    } finally {
      setIsSubmitting(false);
    }
  };

  // Clears all state to start again
  const handleReset = () => {
    setFile(null);
    setGeneratedSql(null);
    setParsedSqlLines([]);
  };

  return (
    <div className="flex min-h-[85vh] items-center justify-center p-4">
      <Card className="w-full max-w-4xl border-zinc-800 bg-zinc-950 text-zinc-100 shadow-xl">
        <CardHeader className="border-b border-zinc-800 pb-6 text-center">
          <CardTitle className="text-2xl font-semibold tracking-tight">
            {parsedSqlLines.length > 0
              ? 'Review and Execute SQL'
              : 'Upload Document'}
          </CardTitle>
          <CardDescription className="text-zinc-400">
            {parsedSqlLines.length > 0
              ? `Review the ${parsedSqlLines.length} extracted data points below.`
              : 'Select a PDF to extract competitor data into a clean SQL format for review.'}
          </CardDescription>
        </CardHeader>

        <CardContent className="pt-6">
          {parsedSqlLines.length === 0 ? (
            // --- Upload State ---
            <div className="flex flex-col gap-6">
              <label
                htmlFor="pdf-upload"
                className={`group flex cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed border-zinc-800 bg-zinc-900/50 p-16 transition-all hover:bg-zinc-900 ${
                  file ? 'border-zinc-500 bg-zinc-900' : ''
                }`}
              >
                <UploadCloud
                  className={`mb-4 h-12 w-12 transition-colors ${file ? 'text-zinc-100' : 'text-zinc-600 group-hover:text-zinc-400'}`}
                />
                <p className="text-base font-medium text-zinc-300">
                  {file ? file.name : 'Click to browse or drag & drop'}
                </p>
                <p className="mt-2 text-xs text-zinc-500">PDF up to 10MB</p>
                <Input
                  id="pdf-upload"
                  type="file"
                  accept=".pdf"
                  className="hidden"
                  onChange={(e) => setFile(e.target.files?.[0] || null)}
                />
              </label>

              <Button
                onClick={handleExtract}
                disabled={!file || isUploading}
                className="w-full h-12 bg-zinc-100 text-zinc-900 hover:bg-zinc-200 disabled:opacity-50"
              >
                {isUploading ? (
                  <>
                    <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Extraction
                    in Progress...
                  </>
                ) : (
                  'Extract Data'
                )}
              </Button>
            </div>
          ) : (
            // --- Review State (Cleaner & Professional) ---
            <div className="flex flex-col gap-4">
              <div className="rounded-lg border border-zinc-800 bg-zinc-900 overflow-hidden">
                <Table className="border-collapse">
                  <TableHeader>
                    <TableRow className="border-zinc-800 hover:bg-zinc-900/50">
                      <TableHead className="w-[12%] text-center text-zinc-500 font-mono">
                        #
                      </TableHead>
                      <TableHead className="w-[88%] text-zinc-300">
                        Generated SQL Statement
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody className="font-mono text-sm">
                    {parsedSqlLines.map((line, index) => (
                      <TableRow
                        key={index}
                        className="border-zinc-800 hover:bg-zinc-900/50"
                      >
                        <TableCell className="w-[12%] text-center text-zinc-600 select-none border-r border-zinc-800">
                          {index + 1}
                        </TableCell>
                        <TableCell className="w-[88%] p-4 text-zinc-300 whitespace-pre-wrap leading-relaxed">
                          {line}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </div>
          )}
        </CardContent>

        {/* Action buttons only show during the Review State */}
        {parsedSqlLines.length > 0 && (
          <CardFooter className="flex justify-between gap-4 border-t border-zinc-800 pt-6">
            <Button
              variant="outline"
              onClick={handleReset}
              disabled={isSubmitting}
              className="border-zinc-700 text-zinc-300 hover:bg-zinc-800 hover:text-zinc-100"
            >
              <X className="mr-2 h-4 w-4" /> Reset and Upload New PDF
            </Button>
            <Button
              onClick={handleConfirmSubmit}
              disabled={isSubmitting}
              className="bg-zinc-100 text-zinc-900 hover:bg-zinc-200"
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Running
                  Queries...
                </>
              ) : (
                <>
                  <Database className="mr-2 h-4 w-4" /> Confirm & Execute (
                  {parsedSqlLines.length} Statements)
                </>
              )}
            </Button>
          </CardFooter>
        )}
      </Card>
    </div>
  );
}
