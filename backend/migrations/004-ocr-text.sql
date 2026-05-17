-- Add OCR text column to nodes table for extracted image/PDF text
-- Run: psql $DATABASE_URL -f backend/migrations/004-ocr-text.sql

ALTER TABLE nodes ADD COLUMN IF NOT EXISTS ocr_text TEXT;

-- GIN index on OCR text for full-text search integration
-- The existing search query will be updated to search both name and ocr_text
CREATE INDEX IF NOT EXISTS idx_nodes_ocr_text
  ON nodes USING GIN (to_tsvector('simple', coalesce(ocr_text, '')));

COMMENT ON COLUMN nodes.ocr_text IS 'Text extracted from image/PDF files via OCR (Tesseract.js)';
