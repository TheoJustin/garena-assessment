import os
from fastapi import FastAPI, UploadFile, File, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from langchain_openai import ChatOpenAI
from langchain_community.document_loaders import PyPDFLoader
from langchain_core.prompts import PromptTemplate
from dotenv import load_dotenv
import tempfile

load_dotenv()

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"], # Your Next.js URL
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Pydantic model for the structured response
class SQLResponse(BaseModel):
    sql: str

@app.post("/process-pdf", response_model=SQLResponse)
async def process_pdf(file: UploadFile = File(...)):
    if not file.filename.lower().endswith(".pdf"):
        raise HTTPException(status_code=400, detail="File must be a PDF")

    try:
        # 1. Save uploaded file to a temporary location 
        # (Python's PyPDFLoader usually requires a file path)
        with tempfile.NamedTemporaryFile(delete=False, suffix=".pdf") as tmp:
            content = await file.read()
            tmp.write(content)
            tmp_path = tmp.name

        # 2. Load and extract text
        loader = PyPDFLoader(tmp_path)
        docs = loader.load()
        pdf_text = "\n".join([doc.page_content for doc in docs])
        
        # Cleanup temp file
        os.remove(tmp_path)

        # 3. Initialize LLM
        # Ensure OPENAI_API_KEY is set in your environment variables
        llm = ChatOpenAI(
            model="gpt-4o",
            temperature=0
        )

        # 4. Define the Prompt
        template = """
        You are an expert Data Engineer and SQL Architect. Your task is to extract competitor analysis data from the provided text and convert it directly into raw SQL INSERT statements.

        <database_schema>
        Table Name: competitor_analysis
        Columns:
        - competitor_name (VARCHAR): Company or product name.
        - feature_name (VARCHAR): Specific feature, service, or functionality.
        - price (VARCHAR): Cost or pricing model.
        - advantages (TEXT): Key strengths or pros.
        - disadvantages (TEXT): Key weaknesses or cons.
        </database_schema>

        <strict_rules>
        1. RAW OUTPUT ONLY: Output absolutely nothing except the SQL INSERT statements. Do NOT wrap the output in ```sql, ```, or any markdown code blocks. No explanations, no greetings.
        2. ESCAPE QUOTES: You MUST escape any single quotes in the extracted text by doubling them (e.g., change "O'Reilly" to 'O''Reilly' or "Promo Jum'at" to 'Promo Jum''at') to prevent SQL syntax errors.
        3. MISSING DATA (NULL): If a field (like price or disadvantages) is not mentioned in the text, use the SQL keyword NULL (without quotes). Do NOT use the string 'NULL', 'N/A', or 'Tidak disebutkan'.
        4. ROW GRANULARITY: If a competitor has multiple distinct features, generate a separate INSERT statement for EACH feature.
        5. PREVENT ANY SQL INJECTION: SQL Injections and all the commands for security issues you will need to parse in before making it into an sql query itself.
        </strict_rules>

        <examples>
        -- Example 1: Standard row with all data present
        INSERT INTO competitor_analysis (competitor_name, feature_name, price, advantages, disadvantages) VALUES ('TechCorp', 'Analisis Otomatis', 'Rp 1.500.000/bulan', 'Sangat cepat dan akurat', 'Antarmuka sulit dipahami pemula');

        -- Example 2: Missing price/disadvantages and demonstrating escaped quotes
        INSERT INTO competitor_analysis (competitor_name, feature_name, price, advantages, disadvantages) VALUES ('Data''s Co', 'Ekspor Laporan PDF', NULL, 'Mendukung format khusus perusahaan', NULL);
        </examples>

        <input_text>
        {text}
        </input_text>
        """
        prompt = PromptTemplate.from_template(template)

        # 5. Chain and Invoke
        chain = prompt | llm
        response = chain.invoke({"text": pdf_text})

        # LangChain Python returns a message object; content is the string
        return SQLResponse(sql=response.content)

    except Exception as e:
        print(f"Error processing PDF: {e}")
        raise HTTPException(status_code=500, detail=str(e))

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)