import hashlib
import json
import os
import tempfile
import time
from functools import lru_cache
from pathlib import Path
from threading import Lock
from typing import Any, Dict, Iterable, List, Optional, Sequence, Set, Tuple
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

from dotenv import load_dotenv
from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response
from langchain_community.document_loaders import PyPDFLoader
from langchain_openai import ChatOpenAI
from langchain_text_splitters import RecursiveCharacterTextSplitter
from pinecone import Pinecone
from pinecone.exceptions import NotFoundException
from pydantic import BaseModel, Field

load_dotenv()

BASE_DIR = Path(__file__).resolve().parent
PROJECT_ROOT = BASE_DIR.parent
STATE_DIRECTORY = Path(os.getenv("STATE_DIRECTORY", BASE_DIR / "pinecone_state"))
DOCUMENT_SUMMARY_PATH = STATE_DIRECTORY / "documents.json"
BUNDLED_PDF_DIR = Path(os.getenv("BUNDLED_PDF_DIR", PROJECT_ROOT / "data" / "pdfs"))

AI_PROVIDER = os.getenv("AI_PROVIDER", "ollama").lower()
OPENROUTER_BASE_URL = os.getenv("OPENROUTER_BASE_URL", "https://openrouter.ai/api/v1")
OPENROUTER_MODEL = os.getenv(
    "OPENROUTER_MODEL", "nvidia/nemotron-nano-9b-v2:free"
)
OLLAMA_BASE_URL = os.getenv("OLLAMA_BASE_URL", "http://host.docker.internal:11434")
OLLAMA_API_KEY = os.getenv("OLLAMA_API_KEY", "ollama")
OLLAMA_CHAT_MODEL = os.getenv("OLLAMA_CHAT_MODEL", "qwen3:8b")

PINECONE_API_KEY = os.getenv("PINECONE_API_KEY", "")
PINECONE_INDEX = os.getenv("PINECONE_INDEX", "")
PINECONE_HOST = os.getenv("PINECONE_HOST", "").strip()
PINECONE_NAMESPACE = os.getenv("PINECONE_NAMESPACE", "regulatory-local")
PINECONE_TEXT_FIELD = os.getenv("PINECONE_TEXT_FIELD", "text")
PINECONE_EMBED_MODEL = os.getenv("PINECONE_EMBED_MODEL", "llama-text-embed-v2")

CHUNK_SIZE = int(os.getenv("CHUNK_SIZE", "1800"))
CHUNK_OVERLAP = int(os.getenv("CHUNK_OVERLAP", "100"))
SIMILARITY_TOP_K = int(os.getenv("SIMILARITY_TOP_K", "6"))
AUTO_INGEST_BUNDLED_PDFS = (
    os.getenv("AUTO_INGEST_BUNDLED_PDFS", "false").lower() == "true"
)
CORS_ORIGINS = [
    origin.strip()
    for origin in os.getenv(
        "CORS_ORIGINS",
        "http://localhost:3001,http://127.0.0.1:3001,http://frontend:3000",
    ).split(",")
    if origin.strip()
]

UPSERT_BATCH_SIZE = 96
DELETE_BATCH_SIZE = 1000
FETCH_BATCH_SIZE = 200
PINECONE_FRESHNESS_TIMEOUT_SECONDS = 20

STATE_DIRECTORY.mkdir(parents=True, exist_ok=True)

app = FastAPI(title="THChat Regulatory Pinecone Backend")

app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

pinecone_index: Optional[Any] = None
pinecone_index_lock = Lock()
document_summary_lock = Lock()


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


def safe_int(value: Any, default: int = 0) -> int:
    try:
        return int(value)
    except (TypeError, ValueError):
        return default


def normalize_pinecone_payload(value: Any) -> Dict[str, Any]:
    if isinstance(value, dict):
        return value

    to_dict = getattr(value, "to_dict", None)
    if callable(to_dict):
        payload = to_dict()
        if isinstance(payload, dict):
            return payload

    model_dump = getattr(value, "model_dump", None)
    if callable(model_dump):
        payload = model_dump()
        if isinstance(payload, dict):
            return payload

    return {}


def serialize_document_summary(document: DocumentSummary) -> Dict[str, Any]:
    return {
        "source": document.source,
        "pages": document.pages,
        "chunks": document.chunks,
        "chunks_indexed": document.chunks_indexed,
        "chunks_skipped": document.chunks_skipped,
    }


def empty_documents_response() -> DocumentsResponse:
    return DocumentsResponse(documents=[], total_chunks=0)


def normalize_cached_document(entry: Dict[str, Any]) -> Optional[DocumentSummary]:
    source = str(entry.get("source", "")).strip()
    if not source:
        return None

    pages = max(0, safe_int(entry.get("pages", 0)))
    chunks = max(0, safe_int(entry.get("chunks", 0)))
    chunks_indexed = max(0, safe_int(entry.get("chunks_indexed", chunks), chunks))
    chunks_skipped = max(0, safe_int(entry.get("chunks_skipped", 0)))

    return DocumentSummary(
        source=source,
        pages=pages,
        chunks=chunks,
        chunks_indexed=chunks_indexed,
        chunks_skipped=chunks_skipped,
    )


def read_documents_summary_cache() -> Optional[DocumentsResponse]:
    if not DOCUMENT_SUMMARY_PATH.exists():
        return None

    try:
        payload = json.loads(DOCUMENT_SUMMARY_PATH.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None

    if not isinstance(payload, dict):
        return None

    raw_documents = payload.get("documents", [])
    if not isinstance(raw_documents, list):
        return None

    documents: List[DocumentSummary] = []
    for raw_document in raw_documents:
        if not isinstance(raw_document, dict):
            continue

        document = normalize_cached_document(raw_document)
        if document is not None:
            documents.append(document)

    documents.sort(key=lambda item: item.source.lower())
    total_chunks = max(
        0,
        safe_int(
            payload.get("total_chunks", sum(document.chunks for document in documents))
        ),
    )
    return DocumentsResponse(documents=documents, total_chunks=total_chunks)


def write_documents_summary_cache(response: DocumentsResponse) -> None:
    payload = {
        "documents": [
            serialize_document_summary(document) for document in response.documents
        ],
        "total_chunks": response.total_chunks,
    }

    with document_summary_lock:
        DOCUMENT_SUMMARY_PATH.parent.mkdir(parents=True, exist_ok=True)
        temp_path = DOCUMENT_SUMMARY_PATH.with_suffix(".tmp")
        temp_path.write_text(json.dumps(payload, indent=2), encoding="utf-8")
        temp_path.replace(DOCUMENT_SUMMARY_PATH)


def clear_documents_summary_cache() -> None:
    with document_summary_lock:
        DOCUMENT_SUMMARY_PATH.unlink(missing_ok=True)


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


def normalize_pinecone_host(host: str) -> str:
    normalized = host.strip()
    if normalized.startswith("https://"):
        normalized = normalized[len("https://") :]
    if normalized.startswith("http://"):
        normalized = normalized[len("http://") :]
    return normalized.rstrip("/")


@lru_cache(maxsize=1)
def get_default_headers() -> Optional[Dict[str, str]]:
    headers: Dict[str, str] = {}
    http_referer = os.getenv("OPENROUTER_HTTP_REFERER")
    app_title = os.getenv("OPENROUTER_APP_TITLE", "THChat Regulatory Pinecone")

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


def require_pinecone_api_key() -> str:
    if not PINECONE_API_KEY:
        raise HTTPException(
            status_code=500,
            detail="PINECONE_API_KEY is missing. Add it to regulatory-local/.env before indexing or chatting.",
        )
    return PINECONE_API_KEY


def get_provider_configuration() -> Tuple[bool, Optional[str]]:
    if AI_PROVIDER == "ollama":
        missing = []
        if not OLLAMA_BASE_URL:
            missing.append("OLLAMA_BASE_URL")
        if not OLLAMA_CHAT_MODEL:
            missing.append("OLLAMA_CHAT_MODEL")
        if missing:
            return False, f"Missing Ollama configuration: {', '.join(missing)}."
        return True, None

    if AI_PROVIDER == "openrouter":
        missing = []
        if not os.getenv("OPENROUTER_API_KEY"):
            missing.append("OPENROUTER_API_KEY")
        if not OPENROUTER_MODEL:
            missing.append("OPENROUTER_MODEL")
        if missing:
            return False, f"Missing OpenRouter configuration: {', '.join(missing)}."
        return True, None

    return False, f"Unsupported AI_PROVIDER '{AI_PROVIDER}'."


def get_pinecone_configuration() -> Tuple[bool, Optional[str]]:
    missing = []
    if not PINECONE_API_KEY:
        missing.append("PINECONE_API_KEY")
    if not PINECONE_HOST and not PINECONE_INDEX:
        missing.append("PINECONE_HOST or PINECONE_INDEX")
    if not PINECONE_TEXT_FIELD:
        missing.append("PINECONE_TEXT_FIELD")

    if missing:
        return False, f"Missing Pinecone configuration: {', '.join(missing)}."

    return True, None


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
    if AI_PROVIDER != "openrouter":
        return None

    api_key = os.getenv("OPENROUTER_API_KEY")
    if not api_key:
        return None

    headers = {"Authorization": f"Bearer {api_key}"}
    default_headers = get_default_headers() or {}
    headers.update(default_headers)
    return headers


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


def build_provider_status() -> ProviderStatus:
    chat_config = get_chat_runtime_config() if get_provider_configuration()[0] else {
        "base_url": normalize_openai_compatible_base_url(OLLAMA_BASE_URL)
        if AI_PROVIDER == "ollama"
        else OPENROUTER_BASE_URL,
        "model": OLLAMA_CHAT_MODEL if AI_PROVIDER == "ollama" else OPENROUTER_MODEL,
    }
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

    expected_models = [str(chat_config.get("model", "") or "").strip()]
    missing_models = [
        model
        for model in expected_models
        if model and reachable and available_models and model not in available_models
    ]

    return ProviderStatus(
        name=AI_PROVIDER,
        base_url=str(chat_config.get("base_url", "")),
        chat_model=str(chat_config.get("model", "")),
        embedding_model=PINECONE_EMBED_MODEL,
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
            f"Configured chat model: {model}.",
        ]

        if "404" in normalized_message or "not found" in normalized_message:
            guidance.append(
                f"Make sure that model is available by running `ollama pull {model}`."
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
    guidance.append(f"Configured chat model: {model}.")
    guidance.append(f"Original error: {raw_message}")
    return " ".join(guidance)


def describe_pinecone_failure(*, phase: str, exc: Exception) -> str:
    raw_message = str(exc).strip() or exc.__class__.__name__
    normalized_message = raw_message.lower()
    target = (
        f"index '{PINECONE_INDEX}'"
        if PINECONE_INDEX
        else f"host '{normalize_pinecone_host(PINECONE_HOST)}'"
    )
    guidance = [
        f"{phase} failed while contacting Pinecone {target}.",
        f"Configured namespace: {PINECONE_NAMESPACE}.",
        f"Integrated embedding field: {PINECONE_TEXT_FIELD}.",
    ]

    if "401" in normalized_message or "403" in normalized_message:
        guidance.append("Verify that PINECONE_API_KEY is present and valid.")
    elif "404" in normalized_message:
        guidance.append(
            "Verify the Pinecone host/index name and make sure the target index still exists."
        )
    elif any(
        token in normalized_message
        for token in ["timed out", "connection refused", "could not", "name or service"]
    ):
        guidance.append("Check network access to the Pinecone host and confirm the index is ready.")

    guidance.append(f"Original error: {raw_message}")
    return " ".join(guidance)


@lru_cache(maxsize=1)
def get_pinecone_client() -> Pinecone:
    return Pinecone(api_key=require_pinecone_api_key())


def get_pinecone_index() -> Any:
    global pinecone_index

    if pinecone_index is None:
        with pinecone_index_lock:
            if pinecone_index is None:
                configured, error = get_pinecone_configuration()
                if not configured:
                    raise HTTPException(status_code=500, detail=error)

                client = get_pinecone_client()
                if PINECONE_HOST:
                    pinecone_index = client.Index(host=normalize_pinecone_host(PINECONE_HOST))
                else:
                    pinecone_index = client.Index(PINECONE_INDEX)

    return pinecone_index


def get_namespace_record_count(index: Any) -> int:
    try:
        payload = index.describe_namespace(namespace=PINECONE_NAMESPACE)
    except NotFoundException:
        return 0

    if isinstance(payload, dict):
        return max(
            0,
            safe_int(
                payload.get("record_count", payload.get("recordCount", 0)),
            ),
        )

    return max(
        0,
        safe_int(
            getattr(payload, "record_count", getattr(payload, "recordCount", 0))
        ),
    )


def wait_for_namespace_record_count(index: Any, expected_count: int) -> int:
    deadline = time.time() + PINECONE_FRESHNESS_TIMEOUT_SECONDS
    last_seen = get_namespace_record_count(index)

    while time.time() < deadline:
        if last_seen == expected_count:
            return last_seen
        time.sleep(0.5)
        last_seen = get_namespace_record_count(index)

    return last_seen


def batched(items: Sequence[Any], batch_size: int) -> Iterable[Sequence[Any]]:
    for start in range(0, len(items), batch_size):
        yield items[start : start + batch_size]


def build_source_prefix(source: str) -> str:
    return f"{hashlib.sha1(source.encode('utf-8')).hexdigest()[:16]}:"


def build_chunk_id(source: str, page: int, content: str) -> str:
    raw = f"{page}|{content}".encode("utf-8")
    return f"{build_source_prefix(source)}{hashlib.sha1(raw).hexdigest()}"


def list_ids_for_source(index: Any, source: str) -> List[str]:
    prefix = build_source_prefix(source)
    ids: List[str] = []

    try:
        for batch in index.list(namespace=PINECONE_NAMESPACE, prefix=prefix):
            ids.extend(str(item) for item in batch)
    except NotFoundException:
        return []

    return ids


def get_existing_ids(index: Any, ids: List[str]) -> Set[str]:
    if not ids:
        return set()

    try:
        response = index.fetch(ids=ids, namespace=PINECONE_NAMESPACE)
    except NotFoundException:
        return set()

    vectors = getattr(response, "vectors", None)
    if vectors is None and isinstance(response, dict):
        vectors = response.get("vectors", {})

    if isinstance(vectors, dict):
        return set(vectors.keys())

    return set()


def delete_ids(index: Any, ids: List[str]) -> None:
    if not ids:
        return

    for batch in batched(ids, DELETE_BATCH_SIZE):
        index.delete(ids=list(batch), namespace=PINECONE_NAMESPACE)


def upsert_records(index: Any, records: List[Dict[str, Any]]) -> None:
    if not records:
        return

    for batch in batched(records, UPSERT_BATCH_SIZE):
        index.upsert_records(namespace=PINECONE_NAMESPACE, records=list(batch))


def rebuild_documents_summary_from_pinecone(index: Any) -> DocumentsResponse:
    total_chunks = get_namespace_record_count(index)
    if total_chunks == 0:
        clear_documents_summary_cache()
        return empty_documents_response()

    aggregated: Dict[str, Dict[str, object]] = {}
    pending_ids: List[str] = []

    def process_pending_ids(ids_to_process: List[str]) -> None:
        if not ids_to_process:
            return

        response = index.fetch(ids=ids_to_process, namespace=PINECONE_NAMESPACE)
        vectors = getattr(response, "vectors", None)
        if vectors is None and isinstance(response, dict):
            vectors = response.get("vectors", {})

        if not isinstance(vectors, dict):
            return

        for vector in vectors.values():
            metadata = getattr(vector, "metadata", None)
            if metadata is None and isinstance(vector, dict):
                metadata = vector.get("metadata", {})
            if not isinstance(metadata, dict):
                continue

            source = str(metadata.get("source", "unknown.pdf"))
            page = safe_int(metadata.get("page_number", 1), 1)

            entry = aggregated.setdefault(
                source,
                {
                    "source": source,
                    "pages": set(),
                    "chunks": 0,
                },
            )
            entry["chunks"] = safe_int(entry["chunks"], 0) + 1
            pages_set = entry["pages"]
            if isinstance(pages_set, set):
                pages_set.add(page)

    try:
        for batch in index.list(namespace=PINECONE_NAMESPACE):
            pending_ids.extend(str(item) for item in batch)
            while len(pending_ids) >= FETCH_BATCH_SIZE:
                process_pending_ids(pending_ids[:FETCH_BATCH_SIZE])
                pending_ids = pending_ids[FETCH_BATCH_SIZE:]
    except NotFoundException:
        clear_documents_summary_cache()
        return empty_documents_response()

    if pending_ids:
        process_pending_ids(pending_ids)

    documents = [
        DocumentSummary(
            source=str(entry["source"]),
            pages=len(entry["pages"]) if isinstance(entry["pages"], set) else 0,
            chunks=safe_int(entry["chunks"]),
            chunks_indexed=safe_int(entry["chunks"]),
            chunks_skipped=0,
        )
        for entry in aggregated.values()
    ]
    documents.sort(key=lambda item: item.source.lower())

    response = DocumentsResponse(
        documents=documents,
        total_chunks=sum(document.chunks for document in documents),
    )
    write_documents_summary_cache(response)
    return response


def write_document_summary_entry(
    *, source: str, pages: int, chunks: int, total_chunks: int
) -> None:
    cached_documents = read_documents_summary_cache() or empty_documents_response()
    documents_by_source = {
        document.source: document for document in cached_documents.documents
    }
    documents_by_source[source] = DocumentSummary(
        source=source,
        pages=pages,
        chunks=chunks,
        chunks_indexed=chunks,
        chunks_skipped=0,
    )
    documents = sorted(documents_by_source.values(), key=lambda item: item.source.lower())
    write_documents_summary_cache(
        DocumentsResponse(documents=documents, total_chunks=total_chunks)
    )


def summarize_indexed_documents() -> DocumentsResponse:
    index = get_pinecone_index()
    total_chunks = get_namespace_record_count(index)

    if total_chunks == 0:
        clear_documents_summary_cache()
        return empty_documents_response()

    cached_documents = read_documents_summary_cache()
    if cached_documents is not None and cached_documents.total_chunks == total_chunks:
        return cached_documents

    return rebuild_documents_summary_from_pinecone(index)


def get_index_overview() -> Tuple[int, int]:
    index = get_pinecone_index()
    total_chunks = get_namespace_record_count(index)
    if total_chunks <= 0:
        clear_documents_summary_cache()
        return 0, 0

    cached_documents = read_documents_summary_cache()
    if cached_documents is not None and cached_documents.total_chunks == total_chunks:
        return len(cached_documents.documents), cached_documents.total_chunks

    return 1, total_chunks


def split_and_prepare_documents(file_path: Path, source_name: str) -> Tuple[List[Any], int]:
    loader = PyPDFLoader(str(file_path))
    pages = loader.load()

    for page in pages:
        page_number = safe_int(page.metadata.get("page", 0), 0) + 1
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
        chunk.metadata["page_number"] = safe_int(chunk.metadata.get("page_number", 1), 1)
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

    index = get_pinecone_index()
    namespace_total_before = get_namespace_record_count(index)

    ids = [
        build_chunk_id(
            source=chunk.metadata.get("source", source),
            page=safe_int(chunk.metadata.get("page_number", 1), 1),
            content=chunk.page_content,
        )
        for chunk in chunks
    ]

    existing_source_ids = list_ids_for_source(index, source)
    existing_source_id_set = set(existing_source_ids)
    existing_current_ids = existing_source_id_set.intersection(ids)
    stale_ids = [chunk_id for chunk_id in existing_source_ids if chunk_id not in ids]

    records_to_upsert: List[Dict[str, Any]] = []
    for chunk, chunk_id in zip(chunks, ids):
        if chunk_id in existing_current_ids:
            continue
        records_to_upsert.append(
            {
                "_id": chunk_id,
                PINECONE_TEXT_FIELD: chunk.page_content,
                "source": chunk.metadata.get("source", source),
                "page_number": safe_int(chunk.metadata.get("page_number", 1), 1),
                "document_type": chunk.metadata.get("document_type", "regulation"),
            }
        )

    if stale_ids:
        delete_ids(index, stale_ids)
    if records_to_upsert:
        upsert_records(index, records_to_upsert)

    expected_total = max(0, namespace_total_before - len(existing_source_ids) + len(chunks))
    confirmed_total = wait_for_namespace_record_count(index, expected_total)
    total_chunks = confirmed_total if confirmed_total > 0 else expected_total

    write_document_summary_entry(
        source=source,
        pages=pages,
        chunks=len(chunks),
        total_chunks=total_chunks,
    )

    chunks_indexed = len(records_to_upsert)
    chunks_skipped = len(chunks) - chunks_indexed
    return DocumentSummary(
        source=source,
        pages=pages,
        chunks=len(chunks),
        chunks_indexed=chunks_indexed,
        chunks_skipped=chunks_skipped,
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
    *,
    indexed_documents: int,
    total_chunks: int,
    provider: ProviderStatus,
    pinecone_ready: bool,
    pinecone_error: Optional[str],
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
                f"{total_chunks} retrieval chunks are ready for search."
                if has_documents
                else "Chunks will be created automatically during ingestion."
            ),
        ),
        WorkflowStep(
            id="pinecone",
            label="Pinecone index",
            status=(
                "complete"
                if has_documents
                else "ready"
                if pinecone_ready
                else "blocked"
            ),
            detail=(
                f"{total_chunks} chunks are stored in Pinecone namespace '{PINECONE_NAMESPACE}'."
                if has_documents
                else (
                    f"Pinecone is ready to index text into namespace '{PINECONE_NAMESPACE}'."
                    if pinecone_ready
                    else pinecone_error
                    or "Finish the Pinecone configuration before indexing."
                )
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
                f"{provider.chat_model} is reachable for answer generation."
                if provider_ready
                else provider.error
                or "Finish configuring the chat provider before sending a question."
            ),
        ),
        WorkflowStep(
            id="answer",
            label="User output",
            status="ready" if has_documents and provider_ready else "pending",
            detail=(
                "Grounded answers can now be generated from retrieved Pinecone hits."
                if has_documents and provider_ready
                else "Answer generation becomes available once Pinecone has indexed content and the chat provider is reachable."
            ),
        ),
    ]


def build_workflow_status() -> WorkflowStatusResponse:
    provider = build_provider_status()
    pinecone_configured, pinecone_configuration_error = get_pinecone_configuration()
    pinecone_ready = False
    pinecone_error = pinecone_configuration_error
    indexed_documents = 0
    total_chunks = 0

    if pinecone_configured:
        try:
            indexed_documents, total_chunks = get_index_overview()
            pinecone_ready = True
            pinecone_error = None
        except Exception as exc:
            pinecone_error = str(exc)

    if not pinecone_configured:
        next_action = (
            "Add the Pinecone API key plus the index host or name in regulatory-local/.env before indexing documents."
        )
    elif not pinecone_ready:
        next_action = (
            "Verify the Pinecone key, index host, and namespace, then refresh this page."
        )
    elif indexed_documents == 0:
        next_action = (
            "Upload a PDF or seed the bundled documents so Pinecone has something to retrieve."
        )
    elif not provider.configured:
        next_action = (
            "Complete the chat provider settings in regulatory-local/.env before asking questions."
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
                "Choose a chat model that exists on OpenRouter or update the configured model ID."
            )
    else:
        next_action = (
            "The workflow is ready. Move to the chat page and ask a business-side regulatory question."
        )

    return WorkflowStatusResponse(
        provider=provider,
        indexed_documents=indexed_documents,
        total_chunks=total_chunks,
        workflow_steps=build_workflow_steps(
            indexed_documents=indexed_documents,
            total_chunks=total_chunks,
            provider=provider,
            pinecone_ready=pinecone_ready,
            pinecone_error=pinecone_error,
        ),
        recommended_next_action=next_action,
    )


@app.on_event("startup")
def startup_tasks() -> None:
    STATE_DIRECTORY.mkdir(parents=True, exist_ok=True)
    pinecone_configured, _ = get_pinecone_configuration()

    if pinecone_configured:
        try:
            get_pinecone_index()
        except Exception as exc:
            print(f"Skipping Pinecone warm-up: {exc}")

    if AUTO_INGEST_BUNDLED_PDFS and pinecone_configured:
        try:
            print("Auto-ingesting bundled PDFs into Pinecone...")
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
    provider_configured, provider_configuration_error = get_provider_configuration()
    pinecone_configured, pinecone_configuration_error = get_pinecone_configuration()
    chat_base_url = (
        normalize_openai_compatible_base_url(OLLAMA_BASE_URL)
        if AI_PROVIDER == "ollama"
        else OPENROUTER_BASE_URL
    )
    chat_model = OLLAMA_CHAT_MODEL if AI_PROVIDER == "ollama" else OPENROUTER_MODEL

    namespace_count = 0
    if pinecone_configured:
        try:
            namespace_count = get_namespace_record_count(get_pinecone_index())
        except Exception:
            namespace_count = 0

    return {
        "status": "ok",
        "ai_provider": AI_PROVIDER,
        "provider_configured": provider_configured,
        "provider_configuration_error": provider_configuration_error,
        "chat_model": chat_model,
        "chat_base_url": chat_base_url,
        "pinecone_configured": pinecone_configured,
        "pinecone_configuration_error": pinecone_configuration_error,
        "pinecone_index": PINECONE_INDEX,
        "pinecone_host": normalize_pinecone_host(PINECONE_HOST),
        "pinecone_namespace": PINECONE_NAMESPACE,
        "pinecone_embed_model": PINECONE_EMBED_MODEL,
        "pinecone_text_field": PINECONE_TEXT_FIELD,
        "pinecone_namespace_record_count": namespace_count,
        "bundled_pdf_dir": str(BUNDLED_PDF_DIR),
        "state_directory": str(STATE_DIRECTORY),
        "document_summary_path": str(DOCUMENT_SUMMARY_PATH),
        "auto_ingest_bundled_pdfs": AUTO_INGEST_BUNDLED_PDFS,
    }


@app.get("/")
def root() -> Dict[str, object]:
    return {
        "name": "THChat Regulatory Pinecone Backend",
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
    try:
        return summarize_indexed_documents()
    except Exception as exc:
        raise HTTPException(
            status_code=500,
            detail=describe_pinecone_failure(
                phase="Document summary refresh",
                exc=exc,
            ),
        ) from exc


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
        raise HTTPException(
            status_code=500,
            detail=describe_pinecone_failure(
                phase="PDF indexing",
                exc=exc,
            ),
        ) from exc
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
        raise HTTPException(
            status_code=500,
            detail=describe_pinecone_failure(
                phase="Bundled document indexing",
                exc=exc,
            ),
        ) from exc


@app.post("/rag-chat", response_model=RagResponse)
def rag_chat(request: RagRequest) -> RagResponse:
    question = request.message.strip()
    if not question:
        raise HTTPException(status_code=400, detail="Question must not be empty.")

    try:
        index = get_pinecone_index()
        total_chunks = get_namespace_record_count(index)
    except Exception as exc:
        raise HTTPException(
            status_code=500,
            detail=describe_pinecone_failure(
                phase="Context retrieval setup",
                exc=exc,
            ),
        ) from exc

    if total_chunks == 0:
        return RagResponse(
            response="I couldn't find any indexed regulatory material yet. Upload a PDF or ingest the bundled OJK documents first.",
            sources=[],
        )

    try:
        search_results = index.search(
            namespace=PINECONE_NAMESPACE,
            query={
                "inputs": {"text": question},
                "top_k": SIMILARITY_TOP_K,
            },
            fields=[PINECONE_TEXT_FIELD, "source", "page_number"],
        )
    except Exception as exc:
        raise HTTPException(
            status_code=500,
            detail=describe_pinecone_failure(
                phase="Context retrieval",
                exc=exc,
            ),
        ) from exc

    search_payload = normalize_pinecone_payload(search_results)
    result_payload = normalize_pinecone_payload(search_payload.get("result", {}))
    hits = result_payload.get("hits", [])

    if not isinstance(hits, list):
        hits = []

    if not hits:
        return RagResponse(
            response="I couldn't find a relevant section in the indexed regulations for that question.",
            sources=[],
        )

    context_blocks: List[str] = []
    sources: List[SourceReference] = []
    seen_sources: Set[Tuple[str, int]] = set()

    for index_number, hit in enumerate(hits, start=1):
        hit_payload = normalize_pinecone_payload(hit)
        if not hit_payload:
            continue

        fields = normalize_pinecone_payload(hit_payload.get("fields", {}))
        if not fields:
            continue

        source = str(fields.get("source", "unknown.pdf"))
        page = safe_int(fields.get("page_number", 1), 1)
        chunk_text = str(fields.get(PINECONE_TEXT_FIELD, "")).strip()
        if not chunk_text:
            continue

        context_blocks.append(
            f"[Source {index_number}] {source} (page {page})\n{chunk_text}"
        )

        source_key = (source, page)
        if source_key not in seen_sources:
            seen_sources.add(source_key)
            sources.append(SourceReference(source=source, page=page))

    if not context_blocks:
        return RagResponse(
            response="I found Pinecone matches, but they did not include usable passage text.",
            sources=[],
        )

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
        ) from exc

    answer = response.content if isinstance(response.content, str) else str(response.content)
    return RagResponse(response=answer, sources=sources)


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=8000)
