import hashlib
import os
import tempfile
from functools import lru_cache
from pathlib import Path
from typing import Dict, List, Optional, Set, Tuple

from chromadb.config import Settings
from dotenv import load_dotenv
from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response
from langchain_community.document_loaders import PyPDFLoader
from langchain_chroma import Chroma
from langchain_openai import ChatOpenAI, OpenAIEmbeddings
from langchain_text_splitters import RecursiveCharacterTextSplitter
from pydantic import BaseModel, Field

load_dotenv()

BASE_DIR = Path(__file__).resolve().parent
PROJECT_ROOT = BASE_DIR.parent
CHROMA_PERSIST_DIRECTORY = Path(
    os.getenv("CHROMA_PERSIST_DIRECTORY", BASE_DIR / "chroma_db")
)
BUNDLED_PDF_DIR = Path(os.getenv("BUNDLED_PDF_DIR", PROJECT_ROOT / "data" / "pdfs"))
CHROMA_COLLECTION = os.getenv("CHROMA_COLLECTION", "ojk-regulatory-documents")
OPENROUTER_BASE_URL = os.getenv("OPENROUTER_BASE_URL", "https://openrouter.ai/api/v1")
OPENROUTER_MODEL = os.getenv(
    "OPENROUTER_MODEL", "nvidia/nemotron-nano-9b-v2:free"
)
OPENROUTER_EMBEDDING_MODEL = os.getenv("OPENROUTER_EMBEDDING_MODEL", "baai/bge-m3")
CHUNK_SIZE = int(os.getenv("CHUNK_SIZE", "1200"))
CHUNK_OVERLAP = int(os.getenv("CHUNK_OVERLAP", "200"))
SIMILARITY_TOP_K = int(os.getenv("SIMILARITY_TOP_K", "6"))
AUTO_INGEST_BUNDLED_PDFS = (
    os.getenv("AUTO_INGEST_BUNDLED_PDFS", "false").lower() == "true"
)
ANONYMIZED_TELEMETRY = os.getenv("ANONYMIZED_TELEMETRY", "false").lower() == "true"
CHROMA_PRODUCT_TELEMETRY_IMPL = os.getenv(
    "CHROMA_PRODUCT_TELEMETRY_IMPL", "telemetry.NoOpProductTelemetry"
)

CHROMA_PERSIST_DIRECTORY.mkdir(parents=True, exist_ok=True)

app = FastAPI(title="THChat Regulatory Local Backend")

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3001",
        "http://127.0.0.1:3001",
        "http://frontend:3000",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

vector_store: Optional[Chroma] = None


class DocumentSummary(BaseModel):
    source: str
    pages: int
    chunks: int
    chunks_indexed: int
    chunks_skipped: int


class DocumentsResponse(BaseModel):
    documents: List[DocumentSummary]
    total_chunks: int


class IngestionResponse(BaseModel):
    documents: List[DocumentSummary]
    total_chunks_indexed: int
    total_chunks_skipped: int


class RagRequest(BaseModel):
    message: str = Field(min_length=1)


class SourceReference(BaseModel):
    source: str
    page: int


class RagResponse(BaseModel):
    response: str
    sources: List[SourceReference]


@lru_cache(maxsize=1)
def get_default_headers() -> Optional[Dict[str, str]]:
    headers: Dict[str, str] = {}
    http_referer = os.getenv("OPENROUTER_HTTP_REFERER")
    app_title = os.getenv("OPENROUTER_APP_TITLE", "THChat Regulatory Local")

    if http_referer:
        headers["HTTP-Referer"] = http_referer

    if app_title:
        headers["X-Title"] = app_title

    return headers or None


def require_openrouter_key() -> str:
    api_key = os.getenv("OPENROUTER_API_KEY")
    if not api_key:
        raise HTTPException(
            status_code=500,
            detail="OPENROUTER_API_KEY is missing. Add it to regulatory-local/.env before using the API.",
        )
    return api_key


@lru_cache(maxsize=1)
def get_embeddings() -> OpenAIEmbeddings:
    return OpenAIEmbeddings(
        model=OPENROUTER_EMBEDDING_MODEL,
        deployment=OPENROUTER_EMBEDDING_MODEL,
        api_key=require_openrouter_key(),
        base_url=OPENROUTER_BASE_URL,
        default_headers=get_default_headers(),
        tiktoken_enabled=False,
        check_embedding_ctx_length=False,
    )


@lru_cache(maxsize=1)
def get_llm() -> ChatOpenAI:
    return ChatOpenAI(
        model=OPENROUTER_MODEL,
        temperature=0,
        api_key=require_openrouter_key(),
        base_url=OPENROUTER_BASE_URL,
        default_headers=get_default_headers(),
        max_retries=2,
    )


def get_vector_store() -> Chroma:
    global vector_store

    if vector_store is None:
        vector_store = Chroma(
            collection_name=CHROMA_COLLECTION,
            embedding_function=get_embeddings(),
            persist_directory=str(CHROMA_PERSIST_DIRECTORY),
            client_settings=Settings(
                anonymized_telemetry=ANONYMIZED_TELEMETRY,
                chroma_product_telemetry_impl=CHROMA_PRODUCT_TELEMETRY_IMPL,
                chroma_telemetry_impl=CHROMA_PRODUCT_TELEMETRY_IMPL,
            ),
        )

    return vector_store


def persist_store(store: Chroma) -> None:
    persist = getattr(store, "persist", None)
    if callable(persist):
        persist()


def build_chunk_id(source: str, page: int, content: str) -> str:
    raw = f"{source}|{page}|{content}".encode("utf-8")
    return hashlib.sha1(raw).hexdigest()


def get_existing_ids(store: Chroma, ids: List[str]) -> Set[str]:
    if not ids:
        return set()

    payload = store._collection.get(ids=ids, include=[])
    return set(payload.get("ids", []))


def split_and_prepare_documents(file_path: Path, source_name: str) -> Tuple[List, int]:
    loader = PyPDFLoader(str(file_path))
    pages = loader.load()

    for page in pages:
        page_number = int(page.metadata.get("page", 0)) + 1
        page.metadata["source"] = source_name
        page.metadata["page_number"] = page_number
        page.metadata["document_type"] = "regulation"

    splitter = RecursiveCharacterTextSplitter(
        chunk_size=CHUNK_SIZE,
        chunk_overlap=CHUNK_OVERLAP,
    )
    chunks = splitter.split_documents(pages)

    for chunk in chunks:
        chunk.metadata["source"] = source_name
        chunk.metadata["page_number"] = int(chunk.metadata.get("page_number", 1))
        chunk.metadata["document_type"] = "regulation"

    return chunks, len(pages)


def ingest_pdf(file_path: Path, source_name: Optional[str] = None) -> DocumentSummary:
    source = source_name or file_path.name
    chunks, pages = split_and_prepare_documents(file_path, source)

    if not chunks:
        raise HTTPException(
            status_code=400,
            detail=f"No extractable text found in '{source}'. Try a text-based PDF.",
        )

    store = get_vector_store()
    ids = [
        build_chunk_id(
            source=chunk.metadata.get("source", source),
            page=int(chunk.metadata.get("page_number", 1)),
            content=chunk.page_content,
        )
        for chunk in chunks
    ]
    existing_ids = get_existing_ids(store, ids)

    new_chunks = []
    new_ids = []
    for chunk, chunk_id in zip(chunks, ids):
        if chunk_id in existing_ids:
            continue
        new_chunks.append(chunk)
        new_ids.append(chunk_id)

    if new_chunks:
        store.add_documents(new_chunks, ids=new_ids)
        persist_store(store)

    chunks_indexed = len(new_chunks)
    chunks_skipped = len(chunks) - chunks_indexed

    return DocumentSummary(
        source=source,
        pages=pages,
        chunks=len(chunks),
        chunks_indexed=chunks_indexed,
        chunks_skipped=chunks_skipped,
    )


def summarize_indexed_documents() -> DocumentsResponse:
    store = get_vector_store()
    collection = store._collection

    if collection.count() == 0:
        return DocumentsResponse(documents=[], total_chunks=0)

    payload = collection.get(include=["metadatas"])
    metadatas = payload.get("metadatas", [])

    aggregated: Dict[str, Dict[str, object]] = {}
    for metadata in metadatas:
        if not metadata:
            continue

        source = str(metadata.get("source", "unknown.pdf"))
        page = int(metadata.get("page_number", metadata.get("page", 0) + 1))

        entry = aggregated.setdefault(
            source,
            {
                "source": source,
                "pages": set(),
                "chunks": 0,
            },
        )
        entry["chunks"] = int(entry["chunks"]) + 1
        pages_set = entry["pages"]
        if isinstance(pages_set, set):
            pages_set.add(page)

    documents = [
        DocumentSummary(
            source=str(entry["source"]),
            pages=len(entry["pages"]) if isinstance(entry["pages"], set) else 0,
            chunks=int(entry["chunks"]),
            chunks_indexed=int(entry["chunks"]),
            chunks_skipped=0,
        )
        for entry in aggregated.values()
    ]
    documents.sort(key=lambda item: item.source.lower())

    return DocumentsResponse(
        documents=documents,
        total_chunks=sum(document.chunks for document in documents),
    )


def ingest_bundled_documents() -> List[DocumentSummary]:
    if not BUNDLED_PDF_DIR.exists():
        raise HTTPException(
            status_code=404,
            detail=f"Bundled PDF directory was not found at {BUNDLED_PDF_DIR}.",
        )

    pdf_paths = sorted(BUNDLED_PDF_DIR.glob("*.pdf"))
    if not pdf_paths:
        raise HTTPException(
            status_code=404,
            detail=f"No PDF files were found in {BUNDLED_PDF_DIR}.",
        )

    return [ingest_pdf(path) for path in pdf_paths]


@app.on_event("startup")
def startup_tasks() -> None:
    CHROMA_PERSIST_DIRECTORY.mkdir(parents=True, exist_ok=True)

    if AUTO_INGEST_BUNDLED_PDFS and os.getenv("OPENROUTER_API_KEY"):
        try:
            print("Auto-ingesting bundled PDFs into Chroma...")
            documents = ingest_bundled_documents()
            print(
                "Auto-ingest complete:",
                ", ".join(
                    f"{document.source} ({document.chunks_indexed} new / {document.chunks_skipped} reused)"
                    for document in documents
                ),
            )
        except Exception as exc:
            print(f"Skipping bundled PDF auto-ingest: {exc}")


@app.get("/health")
def health() -> Dict[str, object]:
    return {
        "status": "ok",
        "collection": CHROMA_COLLECTION,
        "chat_model": OPENROUTER_MODEL,
        "embedding_model": OPENROUTER_EMBEDDING_MODEL,
        "bundled_pdf_dir": str(BUNDLED_PDF_DIR),
        "chroma_persist_directory": str(CHROMA_PERSIST_DIRECTORY),
        "auto_ingest_bundled_pdfs": AUTO_INGEST_BUNDLED_PDFS,
        "anonymized_telemetry": ANONYMIZED_TELEMETRY,
        "chroma_product_telemetry_impl": CHROMA_PRODUCT_TELEMETRY_IMPL,
    }


@app.get("/")
def root() -> Dict[str, object]:
    return {
        "name": "THChat Regulatory Local Backend",
        "status": "ok",
        "docs": "/docs",
        "health": "/health",
        "documents": "/documents",
    }


@app.get("/favicon.ico", include_in_schema=False)
def favicon() -> Response:
    return Response(status_code=204)


@app.get("/documents", response_model=DocumentsResponse)
def list_documents() -> DocumentsResponse:
    return summarize_indexed_documents()


@app.post("/process-pdf", response_model=IngestionResponse)
async def process_pdf(file: UploadFile = File(...)) -> IngestionResponse:
    if not file.filename or not file.filename.lower().endswith(".pdf"):
        raise HTTPException(status_code=400, detail="File must be a PDF")

    try:
        with tempfile.NamedTemporaryFile(delete=False, suffix=".pdf") as tmp:
            content = await file.read()
            tmp.write(content)
            tmp_path = Path(tmp.name)

        document = ingest_pdf(tmp_path, file.filename)
        return IngestionResponse(
            documents=[document],
            total_chunks_indexed=document.chunks_indexed,
            total_chunks_skipped=document.chunks_skipped,
        )
    except HTTPException:
        raise
    except Exception as exc:
        print(f"Error ingesting uploaded PDF: {exc}")
        raise HTTPException(status_code=500, detail=str(exc))
    finally:
        if "tmp_path" in locals() and tmp_path.exists():
            tmp_path.unlink(missing_ok=True)


@app.post("/ingest-bundled-documents", response_model=IngestionResponse)
def ingest_seed_documents() -> IngestionResponse:
    documents = ingest_bundled_documents()
    return IngestionResponse(
        documents=documents,
        total_chunks_indexed=sum(document.chunks_indexed for document in documents),
        total_chunks_skipped=sum(document.chunks_skipped for document in documents),
    )


@app.post("/rag-chat", response_model=RagResponse)
def rag_chat(request: RagRequest) -> RagResponse:
    question = request.message.strip()
    if not question:
        raise HTTPException(status_code=400, detail="Question must not be empty.")

    store = get_vector_store()
    if store._collection.count() == 0:
        return RagResponse(
            response="I couldn't find any indexed regulatory material yet. Upload a PDF or ingest the bundled OJK documents first.",
            sources=[],
        )

    results = store.similarity_search(question, k=SIMILARITY_TOP_K)
    if not results:
        return RagResponse(
            response="I couldn't find a relevant section in the indexed regulations for that question.",
            sources=[],
        )

    context_blocks: List[str] = []
    sources: List[SourceReference] = []
    seen_sources: Set[Tuple[str, int]] = set()

    for index, doc in enumerate(results, start=1):
        source = str(doc.metadata.get("source", "unknown.pdf"))
        page = int(doc.metadata.get("page_number", doc.metadata.get("page", 0) + 1))
        context_blocks.append(
            f"[Source {index}] {source} (page {page})\n{doc.page_content}"
        )

        source_key = (source, page)
        if source_key not in seen_sources:
            seen_sources.add(source_key)
            sources.append(SourceReference(source=source, page=page))

    llm = get_llm()
    system_prompt = """
You are a regulatory analysis assistant for Indonesian banking and business teams.

Rules:
1. Answer strictly from the provided context snippets.
2. If the context is incomplete, say that clearly instead of guessing.
3. Explain the regulation in practical business language, focusing on obligations, permissions, definitions, scope, and operational impact.
4. If the user asks about differences or updates, compare only what is explicitly supported by the retrieved context.
5. Reply in the same language as the user's question.
6. This is a document-grounded explanation, not legal advice.
"""
    user_prompt = f"""
Question:
{question}

Retrieved context:
{chr(10).join(context_blocks)}

Write a concise answer and cite sources inline using this format: [filename p.X].
"""

    response = llm.invoke(
        [
            ("system", system_prompt.strip()),
            ("human", user_prompt.strip()),
        ]
    )
    answer = response.content if isinstance(response.content, str) else str(response.content)

    return RagResponse(response=answer, sources=sources)


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=8000)
