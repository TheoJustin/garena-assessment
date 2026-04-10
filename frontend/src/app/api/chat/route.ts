import {
  streamText,
  tool,
  convertToModelMessages,
  stepCountIs,
  type UIMessage,
} from 'ai';
import { openai } from '@ai-sdk/openai';
import { z } from 'zod';
import { pool } from '@/lib/db';

export async function POST(req: Request) {
  const { messages }: { messages: UIMessage[] } = await req.json();

  const result = streamText({
    model: openai('gpt-4o'),
    stopWhen: stepCountIs(5),
    system: `You are a Data Analyst assistant with access to a PostgreSQL database.

        CRITICAL RULES:
        1. ALWAYS call 'query_postgres' FIRST before answering ANY question about competitors or data.
        2. Base your answer EXCLUSIVELY on the rows returned by the tool. Do NOT use your own training knowledge.
        3. If the tool returns { found: false } or 0 rows, respond with ONLY:
            "I don't have any data about that in our database. Try asking about a competitor we've analyzed."
            Do NOT guess, infer, or use your training knowledge as a fallback.
        4. Quote or reference specific values from the returned rows in your answer.
        5. Write efficient PostgreSQL SELECT queries. NEVER write INSERT, UPDATE, DROP, or DELETE.
        6. Use ILIKE for case-insensitive text searches.
        7. Reply in the same language the user uses (Usually answer either english or indonesian).

        The table 'competitor_analysis' schema:
        - id (SERIAL PRIMARY KEY)
        - competitor_name (VARCHAR)
        - feature_name (VARCHAR)
        - price (VARCHAR)
        - advantages (TEXT)
        - disadvantages (TEXT)
        - pdf_name (VARCHAR)
        
        When answering comparison questions, query multiple columns: 
        SELECT competitor_name, feature_name, advantages, disadvantages, price FROM competitor_analysis WHERE ...

        please do %% in the query because sometimes the user intends to ask the short version of it for example PUBG,
        so you need to %PUBG%

        also instead of doing a lot of where conditions, just use 1 statement, avoid using AND because it will shorten
        the result query and make it hard for you to give output. use AND if and only necessary.
        `,
    messages: await convertToModelMessages(messages),
    tools: {
      query_postgres: tool({
        description:
          'Execute a raw SQL SELECT query to retrieve data from the competitor_analysis table.',
        inputSchema: z.object({
          query: z
            .string()
            .describe('The raw PostgreSQL SELECT query to execute.'),
        }),
        execute: async ({ query }) => {
          console.log('\n🤖 AI is running SQL:', query);

          if (!query.trim().toLowerCase().startsWith('select')) {
            return {
              error: 'Security Exception: Only SELECT queries are permitted.',
            };
          }

          try {
            const { rows } = await pool.query(query);
            console.log(`✅ Query returned ${rows.length} rows.`);
            console.log('📦 Data returned:', JSON.stringify(rows, null, 2)); // ADD THIS

            if (rows.length === 0) {
              return { message: 'No data found for this query.', rows: [] };
            }

            return rows as Record<string, unknown>[];
          } catch (error) {
            console.error('❌ SQL Error:', error);
            return { error: (error as Error).message };
          }
        },
      }),
    },
  });

  return result.toUIMessageStreamResponse();
}
