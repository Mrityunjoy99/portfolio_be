-- Migration: Add uploads table for storing files in PostgreSQL
-- This migration adds a table to store uploaded files as binary data for container persistence

-- Create uploads table for file storage
CREATE TABLE IF NOT EXISTS uploads (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  filename VARCHAR(255) NOT NULL UNIQUE,
  original_name VARCHAR(255) NOT NULL,
  mime_type VARCHAR(100) NOT NULL,
  file_size BIGINT NOT NULL,
  file_data BYTEA NOT NULL, -- Binary data storage
  upload_path VARCHAR(500), -- Virtual path for compatibility
  uploaded_by VARCHAR(100), -- Track who uploaded (admin username)
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Create indexes for better performance
CREATE INDEX IF NOT EXISTS idx_uploads_filename ON uploads(filename);
CREATE INDEX IF NOT EXISTS idx_uploads_mime_type ON uploads(mime_type);
CREATE INDEX IF NOT EXISTS idx_uploads_created_at ON uploads(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_uploads_uploaded_by ON uploads(uploaded_by);

-- Add trigger for updated_at
CREATE TRIGGER update_uploads_updated_at 
  BEFORE UPDATE ON uploads 
  FOR EACH ROW 
  EXECUTE FUNCTION update_updated_at_column();

-- Add comment for documentation
COMMENT ON TABLE uploads IS 'Stores uploaded files as binary data for container persistence';
COMMENT ON COLUMN uploads.file_data IS 'Binary content of the uploaded file';
COMMENT ON COLUMN uploads.upload_path IS 'Virtual path for backward compatibility with file system storage';
