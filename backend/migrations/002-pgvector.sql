-- pgvector extension + semantic search infrastructure
-- Run: psql $DATABASE_URL -f backend/migrations/002-pgvector.sql

-- Enable pgvector extension (requires superuser or CREATE EXTENSION privilege)
CREATE EXTENSION IF NOT EXISTS vector;

-- Node embeddings table for semantic search
-- Each row stores an embedding vector for a node's text content
CREATE TABLE IF NOT EXISTS node_embeddings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  node_id UUID NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
  embedding VECTOR(1536), -- OpenAI text-embedding-3-small default dim
  model VARCHAR(100) DEFAULT 'text-embedding-3-small',
  content_hash VARCHAR(64), -- SHA256 of source text, for cache invalidation
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Each node has at most one embedding row
CREATE UNIQUE INDEX IF NOT EXISTS idx_node_embeddings_node_id
  ON node_embeddings(node_id);

-- HNSW index for fast ANN search (cosine distance)
-- Requires pgvector 0.5.0+. Works on empty table; add when embeddings exist.
-- CREATE INDEX IF NOT EXISTS idx_node_embeddings_hnsw
--   ON node_embeddings
--   USING hnsw (embedding vector_cosine_ops);
