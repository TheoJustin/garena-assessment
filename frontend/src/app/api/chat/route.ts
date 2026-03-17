import {
  streamText,
  tool,
  convertToModelMessages,
  stepCountIs,
  type UIMessage,
} from 'ai';
import { openai } from '@ai-sdk/openai';
import { z } from 'zod';
import { Pool } from 'pg';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

export async function POST(req: Request) {
  const { messages }: { messages: UIMessage[] } = await req.json();

  const result = streamText({
    model: openai('gpt-4o'),
    stopWhen: stepCountIs(5),
    system: `You are a brilliant Data Analyst assistant. 
    You have access to a PostgreSQL database containing competitor analysis data.
    
    The table is named 'competitor_analysis' and has the following schema:
    - id (SERIAL PRIMARY KEY)
    - competitor_name (VARCHAR)
    - feature_name (VARCHAR)
    - price (VARCHAR) - Note: This might contain text like '$50/month' or 'Gratis', so use ILIKE or cast carefully if comparing numbers.
    - advantages (TEXT)
    - disadvantages (TEXT)
    - pdf_name (VARCHAR)

    Rules:
    1. ALWAYS use the 'query_postgres' tool to fetch data before answering questions about competitors, features, or pricing.
    2. Write efficient PostgreSQL SELECT queries. NEVER write INSERT, UPDATE, DROP, or DELETE queries.
    3. Use ILIKE for text searches to make them case-insensitive.
    4. Answer the user's question in a friendly, professional manner using Natural Language. 
    5. Reply in the same language the user asks the question in (e.g., Indonesian if they ask in Indonesian).`,
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
