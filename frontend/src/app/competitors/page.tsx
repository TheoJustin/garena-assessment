import { Pool } from 'pg';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Card, CardContent } from '@/components/ui/card';
import { Database, FileText } from 'lucide-react';

export const dynamic = 'force-dynamic';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

async function getCompetitors() {
  try {
    const { rows } = await pool.query(
      'SELECT * FROM competitor_analysis ORDER BY competitor_name ASC, id DESC',
    );
    return rows;
  } catch (error) {
    console.error('Failed to fetch data:', error);
    return [];
  }
}

export default async function CompetitorsPage() {
  const data = await getCompetitors();

  return (
    <div className="min-h-screen bg-zinc-950 p-8 text-zinc-100">
      <div className="mx-auto max-w-6xl">
        <div className="mb-8 flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-semibold tracking-tight">
              Competitor Analysis
            </h1>
            <p className="mt-1 text-zinc-400">
              Extracted feature comparisons and market data.
            </p>
          </div>
          <div className="flex items-center gap-2 rounded-full border border-zinc-800 bg-zinc-900/50 px-4 py-1.5 text-sm text-zinc-400">
            <Database className="h-4 w-4" />
            <span>{data.length} Records</span>
          </div>
        </div>
        <Card className="border-zinc-800 bg-zinc-900/30 shadow-none">
          <CardContent className="p-0">
            <div className="w-full rounded-md">
              <Table className="w-full table-fixed">
                <TableHeader className="border-b border-zinc-800 bg-zinc-900/50">
                  <TableRow className="border-zinc-800 hover:bg-transparent">
                    <TableHead className="w-[20%] py-4 pl-6 font-medium text-zinc-300">
                      Competitor
                    </TableHead>
                    <TableHead className="w-[20%] py-4 font-medium text-zinc-300">
                      Feature
                    </TableHead>
                    <TableHead className="w-[10%] py-4 font-medium text-zinc-300">
                      Price
                    </TableHead>
                    <TableHead className="w-[25%] py-4 font-medium text-zinc-300">
                      Advantages
                    </TableHead>
                    <TableHead className="w-[25%] py-4 pr-6 font-medium text-zinc-300">
                      Disadvantages
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.length === 0 ? (
                    <TableRow className="border-zinc-800">
                      <TableCell
                        colSpan={5}
                        className="h-32 text-center text-zinc-500"
                      >
                        No competitor data found. Upload a PDF first.
                      </TableCell>
                    </TableRow>
                  ) : (
                    data.map((row) => (
                      <TableRow
                        key={row.id}
                        className="border-zinc-800 transition-colors hover:bg-zinc-900/50"
                      >
                        <TableCell className="break-words py-4 pl-6 align-top whitespace-normal">
                          <div className="flex flex-col gap-1">
                            <span className="font-medium text-zinc-200">
                              {row.competitor_name}
                            </span>
                            {/* NEW: Display the PDF name subtly below the competitor name */}
                            {row.pdf_name && (
                              <span className="flex items-center text-xs text-zinc-500 font-normal">
                                <FileText className="mr-1.5 h-3 w-3 shrink-0" />
                                <span className="truncate" title={row.pdf_name}>
                                  {row.pdf_name}
                                </span>
                              </span>
                            )}
                          </div>
                        </TableCell>
                        <TableCell className="break-words py-4 align-top text-zinc-300 whitespace-normal">
                          {row.feature_name}
                        </TableCell>
                        <TableCell className="py-4 align-top">
                          {row.price ? (
                            <span className="inline-flex items-center rounded-md bg-zinc-800/80 px-2 py-1 text-xs font-medium text-zinc-300 ring-1 ring-inset ring-zinc-700/50 break-words whitespace-normal">
                              {row.price}
                            </span>
                          ) : (
                            <span className="text-sm text-zinc-600">—</span>
                          )}
                        </TableCell>
                        <TableCell className="break-words py-4 pr-4 align-top text-sm leading-relaxed text-zinc-400 whitespace-normal">
                          {row.advantages || (
                            <span className="text-zinc-600">—</span>
                          )}
                        </TableCell>
                        <TableCell className="break-words py-4 pr-6 align-top text-sm leading-relaxed text-zinc-400 whitespace-normal">
                          {row.disadvantages || (
                            <span className="text-zinc-600">—</span>
                          )}
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
