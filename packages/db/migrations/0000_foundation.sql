-- Foundation migration (Stage 2).
-- Enables the PostgreSQL extensions required by the approved architecture.
-- No application tables are created here; those arrive in Stage 3.

-- Trigram matching: tolerant keyword search (small spelling mistakes, clause numbers).
CREATE EXTENSION IF NOT EXISTS pg_trgm;
--> statement-breakpoint

-- pgvector: stores embeddings for meaning-based search and AI retrieval.
CREATE EXTENSION IF NOT EXISTS vector;
