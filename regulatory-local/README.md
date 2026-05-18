# THChat Regulatory Local

A separate local-first copy of the original app for regulatory and business documents.

This variant changes the architecture in three important ways:

- It uses a local Chroma vector store instead of Pinecone.
- It uses an OpenAI-compatible API layer for both chat generation and embeddings, so you can swap between OpenRouter and Ollama.
- It is tuned for regulatory explanation workflows rather than competitor SQL extraction.

## Workflow

The intended operator flow is:

1. `PDF -> text extraction`
2. `text -> chunks`
3. `chunks -> local ChromaDB`
4. `user question -> retrieval`
5. `retrieved context -> Ollama or OpenRouter`
6. `grounded answer -> user output`

The frontend now exposes this flow directly through the workflow status panel on both the Upload and Chat pages.
If something is off, check these endpoints:

- `GET /health`
- `GET /workflow-status`
- `GET /documents`

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

Copy the example file and fill in your provider settings:

```bash
cp .env.example .env
```

Required for OpenRouter:

- `OPENROUTER_API_KEY`

Useful defaults already included:

- `AI_PROVIDER=openrouter`
- `OPENROUTER_MODEL=nvidia/nemotron-nano-9b-v2:free`
- `OPENROUTER_EMBEDDING_MODEL=baai/bge-m3`
- `AUTO_INGEST_BUNDLED_PDFS=false`
- `CHROMA_PRODUCT_TELEMETRY_IMPL=telemetry.NoOpProductTelemetry`

## Switching to Ollama

This project can now switch between OpenRouter and an Ollama server using env vars only.

### 1. Prepare Ollama on the VPS

Make sure the Ollama service is running and reachable from where this app is running.

If Ollama is on the same Docker host as this project:

- the default `OLLAMA_BASE_URL=http://host.docker.internal:11434` is the easiest option
- `docker-compose.yml` now maps `host.docker.internal` through `host-gateway`, which helps on modern Linux Docker engines as well as Docker Desktop

If Ollama is on a separate VPS:

- expose Ollama on a reachable host and port
- for direct access, bind it to `0.0.0.0:11434`
- if you prefer TLS and auth, place it behind your reverse proxy and point `OLLAMA_BASE_URL` at that URL

Typical Linux/systemd setup idea:

```bash
sudo systemctl edit ollama
```

Add:

```ini
[Service]
Environment="OLLAMA_HOST=0.0.0.0:11434"
```

Then reload and restart:

```bash
sudo systemctl daemon-reload
sudo systemctl restart ollama
```

### 2. Pull the models you plan to use

Example:

```bash
ollama pull qwen3:8b
ollama pull embeddinggemma
```

You can verify the server and model list with:

```bash
curl http://your-vps-ip:11434/api/tags
```

### 3. Update `.env`

1. Set `AI_PROVIDER=ollama`
2. Set `OLLAMA_BASE_URL` to your VPS endpoint, for example `http://your-vps-ip:11434`
3. Set `OLLAMA_CHAT_MODEL`, for example `qwen3:8b`
4. Set `OLLAMA_EMBEDDING_MODEL`, for example `embeddinggemma`

Example:

```env
AI_PROVIDER=ollama
OLLAMA_BASE_URL=http://your-vps-ip:11434
OLLAMA_API_KEY=ollama
OLLAMA_CHAT_MODEL=qwen3:8b
OLLAMA_EMBEDDING_MODEL=embeddinggemma
```

Notes:

- Ollama's OpenAI-compatible API expects a `/v1` base URL. The backend normalizes this automatically, so `http://your-vps-ip:11434` is fine.
- `OLLAMA_API_KEY` is required by OpenAI-compatible clients but ignored by Ollama, so the default `ollama` value is enough unless you place your VPS behind your own auth layer.
- If you use Docker, do not point `OLLAMA_BASE_URL` to `localhost` unless Ollama is inside the same container. For a VPS, use its reachable host or domain.
- The chat model and the embedding model both need to exist on the Ollama side. If one is missing, the workflow status panel will flag it and the backend error messages will tell you which `ollama pull` command to run.

### 4. Rebuild and validate

```bash
docker compose up --build
```

Then check:

- frontend: [http://localhost:3001](http://localhost:3001)
- backend workflow status: [http://localhost:8001/workflow-status](http://localhost:8001/workflow-status)
- backend docs: [http://localhost:8001/docs](http://localhost:8001/docs)

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
- `GET /workflow-status` reports whether the full `PDF -> Chroma -> provider -> answer` path is ready
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
- The UI now surfaces provider reachability, indexed chunk counts, and missing-model states directly from `/workflow-status`.
- For local non-Docker runs, Python 3.11 is the safest choice. Docker is the easiest path if your machine defaults to Python 3.13.
- Answers are grounded in retrieved chunks and should be treated as document explanations, not legal advice.
