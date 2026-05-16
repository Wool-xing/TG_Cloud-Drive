-- Full-text search setup for TG云盘
-- Run: psql $DATABASE_URL -f migrations/001-fulltext-search.sql

-- Enable pg_trgm extension for fuzzy search (optional)
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- GIN index on tsvector expression for full-text search on file/folder names
-- This index supports to_tsvector('simple', name) @@ to_tsquery('simple', ...) queries
CREATE INDEX IF NOT EXISTS idx_nodes_name_fts
  ON nodes
  USING GIN (to_tsvector('simple', name));

-- Trigram index for LIKE/ILIKE fallback queries
CREATE INDEX IF NOT EXISTS idx_nodes_name_trgm
  ON nodes
  USING GIN (name gin_trgm_ops);

-- Add generated tsvector column for ranking (populated automatically)
-- This is optional — inline to_tsvector() already works. Uncomment for
-- materialized search vectors (faster ranking, needs trigger to stay updated).
--
-- ALTER TABLE nodes ADD COLUMN IF NOT EXISTS search_vector tsvector
--   GENERATED ALWAYS AS (to_tsvector('simple', name)) STORED;
-- CREATE INDEX IF NOT EXISTS idx_nodes_search ON nodes USING GIN (search_vector);
