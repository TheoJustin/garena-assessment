import os
from typing import List, Optional
from fastapi import FastAPI, UploadFile, File, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from langchain_openai import ChatOpenAI, OpenAIEmbeddings
from langchain_community.document_loaders import PyPDFLoader
from langchain_core.prompts import PromptTemplate
from langchain_text_splitters import RecursiveCharacterTextSplitter
from langchain_pinecone import PineconeVectorStore
from pinecone import Pinecone, ServerlessSpec
from dotenv import load_dotenv
import tempfile

load_dotenv()

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# --- Pinecone client setup ---
pc = Pinecone(api_key=os.getenv("PINECONE_API_KEY"))
PINECONE_INDEX = os.getenv("PINECONE_INDEX", "competitor-analysis")

def ensure_index_exists():
    existing = [i.name for i in pc.list_indexes()]
    if PINECONE_INDEX not in existing:
        pc.create_index(
            name=PINECONE_INDEX,
            dimension=1536,
            metric="cosine",
            spec=ServerlessSpec(cloud="aws", region="us-east-1"),
        )

# --- 1. Pydantic Models ---
class FeatureAnalysis(BaseModel):
    competitor_name: str = Field(description="Company or product name.")
    feature_name: str = Field(description="Specific feature, service, or functionality.")
    price: Optional[str] = Field(default=None, description="Cost or pricing model. Leave null if not mentioned.")
    advantages: Optional[str] = Field(default=None, description="Key strengths or pros.")
    disadvantages: Optional[str] = Field(default=None, description="Key weaknesses or cons.")

class ExtractionResult(BaseModel):
    results: List[FeatureAnalysis] = Field(description="List of extracted competitor features.")

class SQLResponse(BaseModel):
    sql: str
    chunks_indexed: int


@app.post("/process-pdf", response_model=SQLResponse)
async def process_pdf(file: UploadFile = File(...)):
    if not file.filename.lower().endswith(".pdf"):
        raise HTTPException(status_code=400, detail="File must be a PDF")

    try:
        # 1. Save and load PDF
        with tempfile.NamedTemporaryFile(delete=False, suffix=".pdf") as tmp:
            content = await file.read()
            tmp.write(content)
            tmp_path = tmp.name

        loader = PyPDFLoader(tmp_path)
        docs = loader.load()
        os.remove(tmp_path)

        pdf_text = "\n".join([doc.page_content for doc in docs])

        # 2. Structured SQL extraction (unchanged)
        llm = ChatOpenAI(model="gpt-4o", temperature=0)
        structured_llm = llm.with_structured_output(ExtractionResult)

        template = """
        You are an expert Data Engineer. Extract competitor analysis data from the provided text.
        
        Rules:
        1. Extract all values in their original English language. Translate them if they're not.
        2. If a field is missing, leave it as null.
        3. If a competitor has multiple distinct features, create a separate entry for each feature.

        <input_text>
        {text}
        </input_text>
        """
        chain = PromptTemplate.from_template(template) | structured_llm
        response_data = chain.invoke({"text": pdf_text})

        safe_pdf_name = file.filename.replace("'", "''")

        sql_statements = []
        for row in response_data.results:
            comp_name = row.competitor_name.replace("'", "''") if row.competitor_name else ""
            feat_name = row.feature_name.replace("'", "''") if row.feature_name else ""
            price     = f"'{row.price.replace(chr(39), chr(39)*2)}'" if row.price else "NULL"
            adv       = f"'{row.advantages.replace(chr(39), chr(39)*2)}'" if row.advantages else "NULL"
            disadv    = f"'{row.disadvantages.replace(chr(39), chr(39)*2)}'" if row.disadvantages else "NULL"
            sql_statements.append(
                f"INSERT INTO competitor_analysis (competitor_name, feature_name, price, advantages, disadvantages, pdf_name) "
                f"VALUES ('{comp_name}', '{feat_name}', {price}, {adv}, {disadv}, '{safe_pdf_name}');"
            )

        final_sql = "\n".join(sql_statements)

        # 3. Chunk + embed + upsert raw PDF pages into Pinecone
        ensure_index_exists()

        # Attach filename as metadata so the chatbot knows which PDF a chunk came from
        for doc in docs:
            doc.metadata["source"] = file.filename

        splitter = RecursiveCharacterTextSplitter(
            chunk_size=1000,
            chunk_overlap=200,
        )
        chunks = splitter.split_documents(docs)

        PineconeVectorStore.from_documents(
            documents=chunks,
            embedding=OpenAIEmbeddings(model="text-embedding-3-small"),
            index_name=PINECONE_INDEX,
        )

        print(f"✅ Indexed {len(chunks)} chunks from '{file.filename}' into Pinecone")

        return SQLResponse(sql=final_sql, chunks_indexed=len(chunks))

    except Exception as e:
        print(f"Error processing PDF: {e}")
        raise HTTPException(status_code=500, detail=str(e))


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)