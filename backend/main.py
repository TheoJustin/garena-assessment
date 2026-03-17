import os
from typing import List, Optional
from fastapi import FastAPI, UploadFile, File, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
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

# --- 1. Pydantic Models for LLM Extraction ---
class FeatureAnalysis(BaseModel):
    competitor_name: str = Field(description="Company or product name.")
    feature_name: str = Field(description="Specific feature, service, or functionality.")
    price: Optional[str] = Field(default=None, description="Cost or pricing model. Leave null if not mentioned.")
    advantages: Optional[str] = Field(default=None, description="Key strengths or pros.")
    disadvantages: Optional[str] = Field(default=None, description="Key weaknesses or cons.")

class ExtractionResult(BaseModel):
    results: List[FeatureAnalysis] = Field(description="List of extracted competitor features.")

# --- 2. API Response Model ---
class SQLResponse(BaseModel):
    sql: str

@app.post("/process-pdf", response_model=SQLResponse)
async def process_pdf(file: UploadFile = File(...)):
    if not file.filename.lower().endswith(".pdf"):
        raise HTTPException(status_code=400, detail="File must be a PDF")

    try:
        # Save uploaded file to a temporary location 
        with tempfile.NamedTemporaryFile(delete=False, suffix=".pdf") as tmp:
            content = await file.read()
            tmp.write(content)
            tmp_path = tmp.name

        # Load and extract text
        loader = PyPDFLoader(tmp_path)
        docs = loader.load()
        pdf_text = "\n".join([doc.page_content for doc in docs])
        
        # Cleanup temp file
        os.remove(tmp_path)

        # Initialize LLM
        llm = ChatOpenAI(
            model="gpt-4o",
            temperature=0
        )

        # Bind the Pydantic model to the LLM to force JSON output
        structured_llm = llm.with_structured_output(ExtractionResult)

        # Define the simplified Prompt 
        # (We no longer need extreme SQL rules because Pydantic handles the structure)
        template = """
        You are an expert Data Engineer. Extract competitor analysis data from the provided text.
        
        Rules:
        1. Translate all extracted values into Indonesian.
        2. If a field is missing, leave it as null.
        3. If a competitor has multiple distinct features, create a separate entry for each feature.

        <input_text>
        {text}
        </input_text>
        """
        prompt = PromptTemplate.from_template(template)

        # Chain and Invoke
        chain = prompt | structured_llm
        response_data = chain.invoke({"text": pdf_text})

        # --- 3. Safely Build the SQL in Python ---
        sql_statements = []
        for row in response_data.results: # Iterate through the validated Pydantic objects
            
            # Escape single quotes (SQL injection/syntax defense)
            comp_name = row.competitor_name.replace("'", "''") if row.competitor_name else ""
            feat_name = row.feature_name.replace("'", "''") if row.feature_name else ""
            
            # Handle NULLs and escape quotes for optional fields
            price = f"'{row.price.replace('\'', '\'\'')}'" if row.price else "NULL"
            adv = f"'{row.advantages.replace('\'', '\'\'')}'" if row.advantages else "NULL"
            disadv = f"'{row.disadvantages.replace('\'', '\'\'')}'" if row.disadvantages else "NULL"

            # Construct the final SQL string
            sql = f"INSERT INTO competitor_analysis (competitor_name, feature_name, price, advantages, disadvantages) VALUES ('{comp_name}', '{feat_name}', {price}, {adv}, {disadv});"
            sql_statements.append(sql)

        # Join all statements with a newline
        final_sql = "\n".join(sql_statements)

        return SQLResponse(sql=final_sql)

    except Exception as e:
        print(f"Error processing PDF: {e}")
        raise HTTPException(status_code=500, detail=str(e))

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)