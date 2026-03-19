# THChat — AI-Powered Competitor Analysis Platform

A full-stack application that lets you upload competitor analysis PDFs, extract structured data into PostgreSQL, and query it using natural language or RAG-based chat.

---

## System Architecture

### Architecture Diagram

![System Architecture](https://i.imgur.com/JZd5raA.png)

### Architecture Overview (Text)

| Flow | Path |
|---|---|
| **Upload PDF** | Upload Page → FastAPI (PyPDFLoader) → Pydantic (GPT-4o) → SQL generated → Human reviews → PostgreSQL + Pinecone |
| **NL-to-SQL Chat** | Next.js Chat → AI SDK → OpenAI → `query_postgres` tool → PostgreSQL → Response |
| **RAG Chat** | RAG Widget → Pinecone semantic search → OpenAI → Answer |
| **Data Page** | Next.js → Direct PostgreSQL query → Table view |

---

## Running with Docker

### Prerequisites

- [Docker Desktop](https://www.docker.com/products/docker-desktop/) installed and running
- OpenAI API key
- Pinecone API key

### 1. Clone and configure environment

```bash
git clone <your-repo-url>
cd thchat
```

Create a `.env` file in the project root:

```env
POSTGRES_USER=admin
POSTGRES_PASSWORD=your_password
POSTGRES_DB=competitor_analysis_db
OPENAI_API_KEY=sk-...
PINECONE_API_KEY=your_pinecone_key
PINECONE_INDEX=competitor-analysis
```

> ⚠️ Never commit `.env` to Git. Add it to `.gitignore`.

### 2. Build and run

```bash
docker compose up --build
```

### 3. Access the app

| Service | URL |
|---|---|
| Frontend | http://localhost:3000 |
| Backend (FastAPI) | http://localhost:8000 |
| API Docs (Swagger) | http://localhost:8000/docs |

### 4. Stopping the app

```bash
# Stop containers (keeps database data)
docker compose down

# Stop and wipe database volume (full reset)
docker compose down
docker volume rm garena_postgres_data
```

### Project Structure

```
thchat/
├── docker-compose.yml
├── .env                  ← secrets (never commit)
├── .env.example          ← template for teammates
├── postgres/
│   └── init.sql          ← auto-creates table on first run
├── frontend/             ← Next.js app
│   ├── Dockerfile
│   └── ...
└── backend/              ← FastAPI app
    ├── Dockerfile
    ├── main.py
    └── requirements.txt
```

---

## Example Input & Output

### Input Document

A PDF market research report containing competitor game analysis, for example:

> *"PlayerUnknown's Battlegrounds (PUBG) features a shrinking map mechanic that encourages player conflict and strategic navigation. The battle pass system provides positive reinforcement loops not tied solely to winning."*

### Extracted SQL Output

After uploading, the system generates SQL for review:

```sql
INSERT INTO competitor_analysis (competitor_name, feature_name, price, advantages, disadvantages, pdf_name)
VALUES ('PlayerUnknown''s Battlegrounds (PUBG)', 'Battle pass system', NULL, 'Provides positive reinforcement loops that aren''t only tied to winning games.', NULL, 'battle-royale-report.pdf');

INSERT INTO competitor_analysis (competitor_name, feature_name, price, advantages, disadvantages, pdf_name)
VALUES ('PlayerUnknown''s Battlegrounds (PUBG)', 'Shrinking map mechanic', NULL, 'Encourages player conflict and strategic navigation of the terrain.', NULL, 'battle-royale-report.pdf');
```

### NL-to-SQL Chat Example

**Input:**
> "According to the report, which of the following best describes the primary mechanics of a battle royale game?"

**System process:**
```sql
SELECT competitor_name, feature_name, advantages
FROM competitor_analysis
WHERE competitor_name ILIKE '%PUBG%'
   OR feature_name ILIKE '%battle royale%'
```

**Output:**
> Based on the database, the primary mechanic is **surviving as the last player standing**, supported by a **shrinking map** that forces player conflict and strategic terrain navigation, along with **scavenging for items** to build a toolkit of consumables and weapons.

---

## Limitations

### 1. PDF Quality Dependency
The extraction quality depends entirely on the PDF content. Scanned PDFs, image-based PDFs, or poorly formatted documents may result in incomplete or inaccurate extraction. Only text-based PDFs are supported.

### 2. Human SQL Review Required
After PDF processing, the generated SQL is shown to the user for manual review before execution. This is intentional to prevent SQL injection and ensure data accuracy — but it adds a manual step to the upload flow.

### 3. NL-to-SQL Accuracy
The NL-to-SQL chat generates SQL dynamically using GPT-4o. Complex or ambiguous questions may produce incorrect queries. The system is instructed to only answer from database rows, but edge cases may still occur.

### 4. Schema is Fixed
The `competitor_analysis` table has a fixed schema (competitor name, feature, price, advantages, disadvantages). PDFs that contain data outside this structure (e.g. market share percentages, timelines) will not be captured.

### 5. Pinecone Index Region
The Pinecone index is configured for `aws us-east-1`. Latency may vary if deployed to a different region.

### 6. No Authentication
The current system has no user authentication. All uploaded data and chat history is accessible to anyone with access to the URL. This should be addressed before any public deployment.

### 7. Data Isolation
Data uploaded in local development does not carry over to the Docker environment (and vice versa), since they use separate PostgreSQL instances. You must re-upload PDFs after switching environments.
