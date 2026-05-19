# THChat Regulatory Pinecone

A Pinecone-backed regulatory RAG app for OJK, BPR, and BPRS documents.

This copy now uses:

- Pinecone for vector storage and retrieval
- Pinecone integrated embeddings for faster indexing and search
- Ollama or OpenRouter only for final answer generation

## Workflow

The intended flow is:

1. `PDF -> text extraction`
2. `text -> chunks`
3. `chunks -> Pinecone integrated embedding + storage`
4. `user question -> Pinecone text search`
5. `retrieved context -> Ollama or OpenRouter`
6. `grounded answer -> user output`

If something feels off, check:

- `GET /health`
- `GET /workflow-status`
- `GET /documents`

## Bundled PDFs

- `data/pdfs/pojk-2020-62-bank-perkreditan-rakyat-1.pdf`
- `data/pdfs/pojk-2024-7-bpr-dan-bprs.pdf`

Auto-ingest is off by default so the containers start quickly.

## Environment

Copy the example file:

```bash
cp .env.example .env
```

### Required Pinecone settings

- `PINECONE_API_KEY`
- `PINECONE_INDEX`
- `PINECONE_HOST`

Useful defaults already included:

- `PINECONE_INDEX=chatbot-komunal`
- `PINECONE_HOST=chatbot-komunal-rlrsd9x.svc.aped-4627-b74a.pinecone.io`
- `PINECONE_NAMESPACE=regulatory-local`
- `PINECONE_TEXT_FIELD=text`
- `PINECONE_EMBED_MODEL=llama-text-embed-v2`

The current demo index uses Pinecone integrated embeddings with a `text -> text` field map, so the backend sends chunk text directly to Pinecone and does not need a separate embedding model provider.

### Chat provider options

You can keep either:

- `AI_PROVIDER=ollama`
- `AI_PROVIDER=openrouter`

For Ollama, the typical fields are:

```env
AI_PROVIDER=ollama
OLLAMA_BASE_URL=http://host.docker.internal:11434
OLLAMA_API_KEY=ollama
OLLAMA_CHAT_MODEL=qwen2.5:1.5b-instruct
```

For OpenRouter, the typical fields are:

```env
AI_PROVIDER=openrouter
OPENROUTER_API_KEY=your_key
OPENROUTER_BASE_URL=https://openrouter.ai/api/v1
OPENROUTER_MODEL=nvidia/nemotron-nano-9b-v2:free
```

### Frontend and timeout settings

If you open the frontend from another machine, point it at the public backend URL:

```env
BACKEND_URL=http://localhost:8001
NEXT_PUBLIC_BACKEND_URL=http://your-vps-ip:8001
CORS_ORIGINS=http://localhost:3001,http://127.0.0.1:3001,http://your-vps-ip:3001
```

Useful timeout and chunk defaults:

```env
NEXT_PUBLIC_BACKEND_FETCH_TIMEOUT_MS=120000
NEXT_PUBLIC_INDEX_UPLOAD_TIMEOUT_MS=900000
CHUNK_SIZE=1800
CHUNK_OVERLAP=100
SIMILARITY_TOP_K=6
MAX_CONTEXT_CHARS_PER_HIT=900
```

## Example `.env`

```env
AI_PROVIDER=ollama

OPENROUTER_API_KEY=
OPENROUTER_BASE_URL=https://openrouter.ai/api/v1
OPENROUTER_MODEL=nvidia/nemotron-nano-9b-v2:free
OPENROUTER_APP_TITLE=THChat Regulatory Pinecone
OPENROUTER_HTTP_REFERER=

OLLAMA_BASE_URL=http://host.docker.internal:11434
OLLAMA_API_KEY=ollama
OLLAMA_CHAT_MODEL=qwen2.5:1.5b-instruct

PINECONE_API_KEY=your_pinecone_key
PINECONE_INDEX=chatbot-komunal
PINECONE_HOST=chatbot-komunal-rlrsd9x.svc.aped-4627-b74a.pinecone.io
PINECONE_NAMESPACE=regulatory-local
PINECONE_TEXT_FIELD=text
PINECONE_EMBED_MODEL=llama-text-embed-v2

BACKEND_URL=http://localhost:8001
NEXT_PUBLIC_BACKEND_URL=http://your-vps-ip:8001
NEXT_PUBLIC_BACKEND_FETCH_TIMEOUT_MS=120000
NEXT_PUBLIC_INDEX_UPLOAD_TIMEOUT_MS=900000
CORS_ORIGINS=http://localhost:3001,http://127.0.0.1:3001,http://your-vps-ip:3001

AUTO_INGEST_BUNDLED_PDFS=false
CHUNK_SIZE=1800
CHUNK_OVERLAP=100
SIMILARITY_TOP_K=6
```

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

## Quality checks

Frontend:

```bash
cd /Users/theo/Documents/Garena/regulatory-local/frontend
npm run lint
npm run typecheck
npm run build
```

Backend:

```bash
PYTHONPYCACHEPREFIX=/tmp/regulatory-local-pyc python3 -m py_compile backend/main.py
```

## Main endpoints

- `POST /process-pdf` uploads and indexes one PDF into Pinecone
- `POST /ingest-bundled-documents` indexes all bundled PDFs into Pinecone
- `GET /documents` lists indexed files with page and chunk counts
- `GET /workflow-status` reports whether the full `PDF -> Pinecone -> provider -> answer` path is ready
- `POST /rag-chat` answers questions from retrieved Pinecone context

## Notes

- Vector storage is now remote in Pinecone, not local in Chroma.
- A small local cache file is still kept at `backend/pinecone_state/documents.json` so the upload page can load quickly even after the index grows.
- Re-ingesting the same PDF reuses unchanged chunk IDs and only upserts new chunks, while stale chunk IDs for that source are removed.
- Pinecone is eventually consistent, so the backend waits briefly for namespace counts to settle after each ingest.
- If the upload dashboard is slow after many PDFs are indexed, increase `NEXT_PUBLIC_BACKEND_FETCH_TIMEOUT_MS`.
- If chat generation is still slow on a CPU-only VPS, lower `SIMILARITY_TOP_K` or `MAX_CONTEXT_CHARS_PER_HIT`.
- If a single upload is slow, Pinecone indexing is usually waiting on PDF extraction/chunking or on the remote write, not on a local embedding model.
- Answers are grounded in retrieved snippets and should be treated as document explanations, not legal advice.
