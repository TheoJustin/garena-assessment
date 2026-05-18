# THChat Regulatory Local

A separate local-first copy of the original app for regulatory and business documents.

This variant changes the architecture in three important ways:

- It uses a local Chroma vector store instead of Pinecone.
- It uses OpenRouter's OpenAI-compatible API for both chat generation and embeddings.
- It is tuned for regulatory explanation workflows rather than competitor SQL extraction.

## What is bundled

- `data/pdfs/pojk-2020-62-bank-perkreditan-rakyat-1.pdf`
- `data/pdfs/pojk-2024-7-bpr-dan-bprs.pdf`

You can ingest those immediately from the Upload page or opt into backend auto-ingest on startup.
The default is now manual ingestion so the containers become ready faster.

## Model defaults

The default chat model is:

- `nvidia/nemotron-nano-9b-v2:free`

Why this default:

- As of May 18, 2026, OpenRouter lists it as a free model.
- OpenRouter describes it as a unified reasoning and non-reasoning model with a 128K context window.
- It is newer than the previous 8B Nemotron pick while still staying in the near-zero-cost range.

The default embedding model is:

- `baai/bge-m3`

Why this default:

- It is multilingual, which fits Indonesian regulatory PDFs better than English-only embeddings.
- OpenRouter lists it at `$0.01 / 1M` input tokens, which is cheap for local RAG indexing.

If you want a slightly more capable low-cost chat model, try:

- `qwen/qwen3-8b`

## Environment

Copy the example file and fill in your OpenRouter key:

```bash
cp .env.example .env
```

Required:

- `OPENROUTER_API_KEY`

Useful defaults already included:

- `OPENROUTER_MODEL=nvidia/nemotron-nano-9b-v2:free`
- `OPENROUTER_EMBEDDING_MODEL=baai/bge-m3`
- `AUTO_INGEST_BUNDLED_PDFS=false`
- `CHROMA_PRODUCT_TELEMETRY_IMPL=telemetry.NoOpProductTelemetry`

## Run with Docker

```bash
docker compose up --build
```

App URLs:

- Frontend: [http://localhost:3001](http://localhost:3001)
- Backend: [http://localhost:8001](http://localhost:8001)
- Backend docs: [http://localhost:8001/docs](http://localhost:8001/docs)

## Run without Docker

Backend:

```bash
cd /Users/theo/Documents/Garena/regulatory-local/backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn main:app --reload --port 8001
```

Frontend:

```bash
cd /Users/theo/Documents/Garena/regulatory-local/frontend
npm install
NEXT_PUBLIC_BACKEND_URL=http://localhost:8001 npm run dev -- --port 3001
```

## Checks

Frontend quality checks:

```bash
cd /Users/theo/Documents/Garena/regulatory-local/frontend
npm run lint
npm run typecheck
```

## Main endpoints

- `POST /process-pdf` uploads and indexes one PDF
- `POST /ingest-bundled-documents` indexes all bundled PDFs
- `GET /documents` lists indexed files with page and chunk counts
- `POST /rag-chat` answers questions from retrieved context

## Notes

- The vector store persists to `backend/chroma_db/`.
- This copy does not depend on PostgreSQL.
- Re-ingesting the same PDF now skips already-indexed chunks instead of embedding them again.
- The frontend includes staged loading and progress feedback for uploads, bundled seeding, and answer generation.
- The copied Next.js app now enables the React Compiler and has a flat ESLint setup for Next.js 16.
- Chroma anonymized telemetry is disabled by default to avoid noisy local startup logs.
- The backend root path now returns a simple JSON status instead of a 404.
- Docker Compose now waits for backend health before starting the frontend.
- For local non-Docker runs, Python 3.11 is the safest choice. Docker is the easiest path if your machine defaults to Python 3.13.
- Answers are grounded in retrieved chunks and should be treated as document explanations, not legal advice.
