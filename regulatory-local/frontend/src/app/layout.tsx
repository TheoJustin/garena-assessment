import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import Link from 'next/link';
import './globals.css';

const inter = Inter({ subsets: ['latin'] });

export const metadata: Metadata = {
  title: 'THChat Regulatory Local',
  description: 'Local-first regulatory RAG for OJK and BPR/BPRS documents.',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark">
      <body
        className={`${inter.className} min-h-screen bg-background text-foreground antialiased`}
      >
        <nav className="sticky top-0 z-50 w-full border-b border-border/40 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
          <div className="container mx-auto flex h-14 max-w-5xl items-center justify-between px-6">
            <Link href="/" className="flex items-center gap-2">
              {/* Logo badge */}
              <div className="flex h-7 w-7 items-center justify-center rounded-md bg-zinc-100 text-xs font-bold text-zinc-900">
                TH
              </div>
              <span className="text-sm font-semibold tracking-tight">
                Regulatory Local
              </span>
            </Link>
            <div className="flex gap-6 text-sm font-medium">
              <Link
                href="/"
                className="text-muted-foreground transition-colors hover:text-foreground"
              >
                Home
              </Link>
              <Link
                href="/upload"
                className="text-muted-foreground transition-colors hover:text-foreground"
              >
                Upload
              </Link>
              <Link
                href="/rag-chat"
                className="text-muted-foreground transition-colors hover:text-foreground"
              >
                Ask AI
              </Link>
            </div>
          </div>
        </nav>
        <main className="container mx-auto max-w-5xl p-6">{children}</main>
      </body>
    </html>
  );
}
