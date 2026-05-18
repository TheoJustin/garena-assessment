import hashlib
import json
import os
import tempfile
from functools import lru_cache
from pathlib import Path
from typing import Any, Dict, List, Optional, Set, Tuple
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

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
AI_PROVIDER = os.getenv("AI_PROVIDER", "openrouter").lower()
OPENROUTER_BASE_URL = os.getenv("OPENROUTER_BASE_URL", "https://openrouter.ai/api/v1")
OPENROUTER_MODEL = os.getenv(
    "OPENROUTER_MODEL", "nvidia/nemotron-nano-9b-v2:free"
)
OPENROUTER_EMBEDDING_MODEL = os.getenv("OPENROUTER_EMBEDDING_MODEL", "baai/bge-m3")
OLLAMA_BASE_URL = os.getenv("OLLAMA_BASE_URL", "http://host.docker.internal:11434")
OLLAMA_API_KEY = os.getenv("OLLAMA_API_KEY", "ollama")
OLLAMA_CHAT_MODEL = os.getenv("OLLAMA_CHAT_MODEL", "qwen3:8b")
OLLAMA_EMBEDDING_MODEL = os.getenv("OLLAMA_EMBEDDING_MODEL", "embeddinggemma")
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


class ProviderStatus(BaseModel):
    name: str
    base_url: str
    chat_model: str
    embedding_model: str
    configured: bool
    reachable: bool
    available_models: List[str]
    missing_models: List[str]
    error: Optional[str] = None


class WorkflowStep(BaseModel):
    id: str
    label: str
    status: str
    detail: str


class WorkflowStatusResponse(BaseModel):
    provider: ProviderStatus
    indexed_documents: int
    total_chunks: int
    workflow_steps: List[WorkflowStep]
    recommended_next_action: str


def normalize_openai_compatible_base_url(base_url: str) -> str:
    normalized = base_url.rstrip("/")
    if normalized.endswith("/v1"):
        return normalized
    return f"{normalized}/v1"


def normalize_ollama_http_base_url(base_url: str) -> str:
    normalized = base_url.rstrip("/")
    if normalized.endswith("/v1"):
        return normalized[:-3]
    return normalized


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


def get_provider_configuration() -> Tuple[bool, Optional[str]]:
    if AI_PROVIDER == "ollama":
        missing = []
        if not OLLAMA_BASE_URL:
            missing.append("OLLAMA_BASE_URL")
        if not OLLAMA_CHAT_MODEL:
            missing.append("OLLAMA_CHAT_MODEL")
        if not OLLAMA_EMBEDDING_MODEL:
            missing.append("OLLAMA_EMBEDDING_MODEL")
        if missing:
            return (
                False,
                f"Missing Ollama configuration: {', '.join(missing)}.",
            )
        return True, None

    if AI_PROVIDER == "openrouter":
        missing = []
        if not os.getenv("OPENROUTER_API_KEY"):
            missing.append("OPENROUTER_API_KEY")
        if not OPENROUTER_MODEL:
            missing.append("OPENROUTER_MODEL")
        if not OPENROUTER_EMBEDDING_MODEL:
            missing.append("OPENROUTER_EMBEDDING_MODEL")
        if missing:
            return (
                False,
                f"Missing OpenRouter configuration: {', '.join(missing)}.",
            )
        return True, None

    return False, f"Unsupported AI_PROVIDER '{AI_PROVIDER}'."


def get_chat_runtime_config() -> Dict[str, Optional[str]]:
    if AI_PROVIDER == "ollama":
        return {
            "api_key": OLLAMA_API_KEY or "ollama",
            "base_url": normalize_openai_compatible_base_url(OLLAMA_BASE_URL),
            "headers": None,
            "model": OLLAMA_CHAT_MODEL,
            "provider": "ollama",
        }

    return {
        "api_key": require_openrouter_key(),
        "base_url": OPENROUTER_BASE_URL,
        "headers": get_default_headers(),
        "model": OPENROUTER_MODEL,
        "provider": "openrouter",
    }


def get_embedding_runtime_config() -> Dict[str, Optional[str]]:
    if AI_PROVIDER == "ollama":
        return {
            "api_key": OLLAMA_API_KEY or "ollama",
            "base_url": normalize_openai_compatible_base_url(OLLAMA_BASE_URL),
            "headers": None,
            "model": OLLAMA_EMBEDDING_MODEL,
            "provider": "ollama",
        }

    return {
        "api_key": require_openrouter_key(),
        "base_url": OPENROUTER_BASE_URL,
        "headers": get_default_headers(),
        "model": OPENROUTER_EMBEDDING_MODEL,
        "provider": "openrouter",
    }


@lru_cache(maxsize=1)
def get_embeddings() -> OpenAIEmbeddings:
    config = get_embedding_runtime_config()
    return OpenAIEmbeddings(
        model=config["model"],
        deployment=config["model"],
        api_key=config["api_key"],
        base_url=config["base_url"],
        default_headers=config["headers"],
        tiktoken_enabled=False,
        check_embedding_ctx_length=False,
    )


@lru_cache(maxsize=1)
def get_llm() -> ChatOpenAI:
    config = get_chat_runtime_config()
    return ChatOpenAI(
        model=config["model"],
        temperature=0,
        api_key=config["api_key"],
        base_url=config["base_url"],
        default_headers=config["headers"],
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


def fetch_json(url: str, headers: Optional[Dict[str, str]] = None) -> Dict[str, Any]:
    request = Request(url, headers=headers or {})

    try:
        with urlopen(request, timeout=4) as response:
            raw_payload = response.read().decode("utf-8")
    except HTTPError as exc:
        error_payload = exc.read().decode("utf-8", errors="ignore").strip()
        detail = error_payload or getattr(exc, "reason", "Unknown HTTP error")
        raise RuntimeError(f"HTTP {exc.code} from {url}: {detail}") from exc
    except URLError as exc:
        raise RuntimeError(f"Could not reach {url}: {exc.reason}") from exc

    try:
        parsed = json.loads(raw_payload)
    except json.JSONDecodeError as exc:
        raise RuntimeError(f"Received non-JSON response from {url}.") from exc

    if not isinstance(parsed, dict):
        raise RuntimeError(f"Unexpected JSON payload from {url}.")

    return parsed


def get_provider_headers() -> Optional[Dict[str, str]]:
    if AI_PROVIDER == "openrouter":
        api_key = os.getenv("OPENROUTER_API_KEY")
        if not api_key:
            return None

        headers = {"Authorization": f"Bearer {api_key}"}
        default_headers = get_default_headers() or {}
        headers.update(default_headers)
        return headers

    return None


def list_available_provider_models() -> List[str]:
    if AI_PROVIDER == "ollama":
        payload = fetch_json(
            f"{normalize_ollama_http_base_url(OLLAMA_BASE_URL)}/api/tags"
        )
        models = payload.get("models", [])
        if not isinstance(models, list):
            return []

        return sorted(
            {
                str(model.get("name", "")).strip()
                for model in models
                if isinstance(model, dict) and model.get("name")
            }
        )

    if AI_PROVIDER == "openrouter":
        headers = get_provider_headers()
        if not headers:
            return []

        payload = fetch_json(f"{OPENROUTER_BASE_URL.rstrip('/')}/models", headers=headers)
        models = payload.get("data", [])
        if not isinstance(models, list):
            return []

        return sorted(
            {
                str(model.get("id", "")).strip()
                for model in models
                if isinstance(model, dict) and model.get("id")
            }
        )

    return []


def build_provider_status() -> ProviderStatus:
    chat_config = get_chat_runtime_config() if AI_PROVIDER == "ollama" else {
        "base_url": OPENROUTER_BASE_URL,
        "model": OPENROUTER_MODEL,
    }
    embedding_config = (
        get_embedding_runtime_config()
        if AI_PROVIDER == "ollama"
        else {
            "base_url": OPENROUTER_BASE_URL,
            "model": OPENROUTER_EMBEDDING_MODEL,
        }
    )
    configured, configuration_error = get_provider_configuration()

    available_models: List[str] = []
    reachable = False
    error = configuration_error

    if configured:
        try:
            available_models = list_available_provider_models()
            reachable = True
            error = None
        except Exception as exc:
            error = str(exc)

    expected_models = [
        str(chat_config.get("model", "") or "").strip(),
        str(embedding_config.get("model", "") or "").strip(),
    ]
    missing_models = (
        [
            model
            for model in expected_models
            if model and reachable and available_models and model not in available_models
        ]
        if AI_PROVIDER == "ollama"
        else []
    )

    return ProviderStatus(
        name=AI_PROVIDER,
        base_url=str(chat_config.get("base_url", "")),
        chat_model=str(chat_config.get("model", "")),
        embedding_model=str(embedding_config.get("model", "")),
        configured=configured,
        reachable=reachable,
        available_models=available_models,
        missing_models=missing_models,
        error=error,
    )


def describe_provider_failure(*, phase: str, exc: Exception, model: str) -> str:
    raw_message = str(exc).strip() or exc.__class__.__name__
    normalized_message = raw_message.lower()

    if AI_PROVIDER == "ollama":
        guidance = [
            f"{phase} failed while contacting Ollama at {OLLAMA_BASE_URL}.",
            f"Configured model: {model}.",
        ]

        if "404" in normalized_message or "not found" in normalized_message:
            guidance.append(
                f"Make sure that model is available on the VPS by running `ollama pull {model}`."
            )
        elif any(
            token in normalized_message
            for token in [
                "connection refused",
                "timed out",
                "failed to establish",
                "name or service not known",
                "nodename nor servname",
                "could not reach",
            ]
        ):
            guidance.append(
                "Check that Ollama is running, bound to a reachable host, and exposed on the configured port."
            )

        guidance.append(f"Original error: {raw_message}")
        return " ".join(guidance)

    guidance = [f"{phase} failed while contacting OpenRouter."]
    if "401" in normalized_message or "unauthorized" in normalized_message:
        guidance.append("Verify that OPENROUTER_API_KEY is present and valid.")
    guidance.append(f"Configured model: {model}.")
    guidance.append(f"Original error: {raw_message}")
    return " ".join(guidance)


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


def build_workflow_steps(
    *, indexed_documents: int, total_chunks: int, provider: ProviderStatus
) -> List[WorkflowStep]:
    has_documents = indexed_documents > 0 and total_chunks > 0
    provider_ready = (
        provider.configured
        and provider.reachable
        and not provider.missing_models
    )

    return [
        WorkflowStep(
            id="pdf",
            label="PDF ingestion",
            status="complete" if has_documents else "pending",
            detail=(
                f"{indexed_documents} indexed document(s) are already available."
                if has_documents
                else "Upload a PDF or seed the bundled OJK regulations first."
            ),
        ),
        WorkflowStep(
            id="chunking",
            label="Chunking",
            status="complete" if has_documents else "pending",
            detail=(
                f"{total_chunks} retrieval chunks are stored for search."
                if has_documents
                else "Chunks will be created automatically during ingestion."
            ),
        ),
        WorkflowStep(
            id="chromadb",
            label="ChromaDB storage",
            status="complete" if has_documents else "pending",
            detail=(
                str(CHROMA_PERSIST_DIRECTORY)
                if has_documents
                else "The local Chroma database will persist vectors after indexing."
            ),
        ),
        WorkflowStep(
            id="question",
            label="User input",
            status="ready" if has_documents else "pending",
            detail=(
                "The chat UI is ready to accept a regulatory question."
                if has_documents
                else "The question step opens up after at least one document is indexed."
            ),
        ),
        WorkflowStep(
            id="provider",
            label=f"{provider.name.title()} query",
            status=(
                "complete"
                if provider_ready
                else "blocked"
                if provider.configured
                else "pending"
            ),
            detail=(
                f"{provider.chat_model} and {provider.embedding_model} are reachable."
                if provider_ready
                else provider.error
                or "Finish configuring the provider before sending a question."
            ),
        ),
        WorkflowStep(
            id="answer",
            label="User output",
            status="ready" if has_documents and provider_ready else "pending",
            detail=(
                "Grounded answers can now be generated from retrieved chunks."
                if has_documents and provider_ready
                else "Answer generation becomes available once Chroma is populated and the provider is reachable."
            ),
        ),
    ]


def build_workflow_status() -> WorkflowStatusResponse:
    documents = summarize_indexed_documents()
    provider = build_provider_status()
    indexed_documents = len(documents.documents)
    total_chunks = documents.total_chunks

    if indexed_documents == 0:
        next_action = (
            "Upload a PDF or seed the bundled documents so Chroma has something to retrieve."
        )
    elif not provider.configured:
        next_action = (
            "Complete the provider settings in regulatory-local/.env before asking questions."
        )
    elif not provider.reachable:
        if provider.name == "ollama":
            next_action = (
                "Bring the Ollama server online, confirm the base URL is reachable from Docker, then refresh this page."
            )
        else:
            next_action = (
                "Verify the OpenRouter key and network access, then refresh this page."
            )
    elif provider.missing_models:
        if provider.name == "ollama":
            missing = ", ".join(provider.missing_models)
            next_action = (
                f"Pull the missing Ollama model(s): {missing}, then retry the chat flow."
            )
        else:
            next_action = (
                "Choose models that exist on OpenRouter or update the configured model IDs."
            )
    else:
        next_action = "The workflow is ready. Move to the chat page and ask a business-side regulatory question."

    return WorkflowStatusResponse(
        provider=provider,
        indexed_documents=indexed_documents,
        total_chunks=total_chunks,
        workflow_steps=build_workflow_steps(
            indexed_documents=indexed_documents,
            total_chunks=total_chunks,
            provider=provider,
        ),
        recommended_next_action=next_action,
    )


@app.on_event("startup")
def startup_tasks() -> None:
    CHROMA_PERSIST_DIRECTORY.mkdir(parents=True, exist_ok=True)

    provider_configured, _ = get_provider_configuration()

    if AUTO_INGEST_BUNDLED_PDFS and provider_configured:
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
    configured, configuration_error = get_provider_configuration()
    chat_base_url = (
        normalize_openai_compatible_base_url(OLLAMA_BASE_URL)
        if AI_PROVIDER == "ollama"
        else OPENROUTER_BASE_URL
    )
    chat_model = OLLAMA_CHAT_MODEL if AI_PROVIDER == "ollama" else OPENROUTER_MODEL
    embedding_model = (
        OLLAMA_EMBEDDING_MODEL
        if AI_PROVIDER == "ollama"
        else OPENROUTER_EMBEDDING_MODEL
    )
    return {
        "status": "ok",
        "ai_provider": AI_PROVIDER,
        "provider_configured": configured,
        "provider_configuration_error": configuration_error,
        "collection": CHROMA_COLLECTION,
        "chat_model": chat_model,
        "chat_base_url": chat_base_url,
        "embedding_model": embedding_model,
        "embedding_base_url": chat_base_url,
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


@app.get("/workflow-status", response_model=WorkflowStatusResponse)
def workflow_status() -> WorkflowStatusResponse:
    return build_workflow_status()


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
        embedding_model = (
            OLLAMA_EMBEDDING_MODEL
            if AI_PROVIDER == "ollama"
            else OPENROUTER_EMBEDDING_MODEL
        )
        raise HTTPException(
            status_code=500,
            detail=describe_provider_failure(
                phase="PDF indexing",
                exc=exc,
                model=embedding_model,
            ),
        )
    finally:
        if "tmp_path" in locals() and tmp_path.exists():
            tmp_path.unlink(missing_ok=True)


@app.post("/ingest-bundled-documents", response_model=IngestionResponse)
def ingest_seed_documents() -> IngestionResponse:
    try:
        documents = ingest_bundled_documents()
        return IngestionResponse(
            documents=documents,
            total_chunks_indexed=sum(document.chunks_indexed for document in documents),
            total_chunks_skipped=sum(document.chunks_skipped for document in documents),
        )
    except HTTPException:
        raise
    except Exception as exc:
        embedding_model = (
            OLLAMA_EMBEDDING_MODEL
            if AI_PROVIDER == "ollama"
            else OPENROUTER_EMBEDDING_MODEL
        )
        raise HTTPException(
            status_code=500,
            detail=describe_provider_failure(
                phase="Bundled document indexing",
                exc=exc,
                model=embedding_model,
            ),
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

    try:
        results = store.similarity_search(question, k=SIMILARITY_TOP_K)
    except Exception as exc:
        embedding_model = (
            OLLAMA_EMBEDDING_MODEL
            if AI_PROVIDER == "ollama"
            else OPENROUTER_EMBEDDING_MODEL
        )
        raise HTTPException(
            status_code=500,
            detail=describe_provider_failure(
                phase="Context retrieval",
                exc=exc,
                model=embedding_model,
            ),
        )

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

    try:
        response = llm.invoke(
            [
                ("system", system_prompt.strip()),
                ("human", user_prompt.strip()),
            ]
        )
    except Exception as exc:
        chat_model = OLLAMA_CHAT_MODEL if AI_PROVIDER == "ollama" else OPENROUTER_MODEL
        raise HTTPException(
            status_code=500,
            detail=describe_provider_failure(
                phase="Answer generation",
                exc=exc,
                model=chat_model,
            ),
        )
    answer = response.content if isinstance(response.content, str) else str(response.content)

    return RagResponse(response=answer, sources=sources)


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=8000)
