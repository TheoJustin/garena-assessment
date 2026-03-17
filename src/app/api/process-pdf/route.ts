import { NextResponse } from 'next/server';
import { WebPDFLoader } from '@langchain/community/document_loaders/web/pdf';
import { ChatOpenAI } from '@langchain/openai';
import { PromptTemplate } from '@langchain/core/prompts';

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const file = formData.get('file') as File;

    if (!file) {
      return NextResponse.json({ error: 'No file provided' }, { status: 400 });
    }

    // 1. Load the PDF directly from the File object
    const loader = new WebPDFLoader(file);
    const docs = await loader.load();

    // Combine all pages into one large string
    const pdfText = docs.map((doc) => doc.pageContent).join('\n');

    // 2. Initialize the LLM
    // (Make sure you have OPENAI_API_KEY in your .env.local)
    const llm = new ChatOpenAI({
      modelName: 'gpt-4o', // or gpt-3.5-turbo
      temperature: 0, // 0 is best for code/SQL generation
    });

    // 3. Create the LangChain Prompt
    const prompt = PromptTemplate.fromTemplate(`
      You are an expert SQL developer. 
      Analyze the following text extracted from a PDF and convert the relevant data into valid SQL INSERT statements.
      
      Ensure you output ONLY the raw SQL queries, no markdown formatting or explanations.
      
      Extracted Text:
      {text}
    `);

    // 4. Create the chain and execute
    const chain = prompt.pipe(llm);
    const response = await chain.invoke({ text: pdfText });

    return NextResponse.json({ sql: response.content });
  } catch (error) {
    console.error('Error processing PDF:', error);
    return NextResponse.json(
      { error: 'Failed to process PDF' },
      { status: 500 },
    );
  }
}
