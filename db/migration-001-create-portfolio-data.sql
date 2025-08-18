-- Migration 001: Create portfolio_data table for key-value store architecture
-- This creates the new unified table to replace the normalized schema

-- Create the portfolio_data table with type-based architecture
CREATE TABLE IF NOT EXISTS portfolio_data (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  key VARCHAR(100) NOT NULL, -- e.g., 'profile', 'skill:uuid', 'experience:uuid'
  type VARCHAR(20) NOT NULL, -- e.g., 'profile', 'skill', 'experience', 'project'
  value JSONB NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Create partial unique constraint for active records only
CREATE UNIQUE INDEX IF NOT EXISTS idx_portfolio_data_key_active 
  ON portfolio_data(key) WHERE is_active = TRUE;

-- Create optimized indexes (minimal set for maximum performance)
CREATE INDEX IF NOT EXISTS idx_portfolio_data_type_active ON portfolio_data(type, is_active) WHERE is_active = TRUE;
CREATE INDEX IF NOT EXISTS idx_portfolio_data_version ON portfolio_data(key, version DESC);

-- Create trigger for updated_at timestamp
CREATE TRIGGER update_portfolio_data_updated_at 
  BEFORE UPDATE ON portfolio_data 
  FOR EACH ROW 
  EXECUTE FUNCTION update_updated_at_column();

-- Add comments for documentation
COMMENT ON TABLE portfolio_data IS 'Unified key-value store for portfolio data with versioning';
COMMENT ON COLUMN portfolio_data.key IS 'Unique identifier for the record (e.g., profile, skill:uuid)';
COMMENT ON COLUMN portfolio_data.type IS 'Type classification for efficient querying (e.g., skill, experience, project)';
COMMENT ON COLUMN portfolio_data.value IS 'JSON document containing the actual data';
COMMENT ON COLUMN portfolio_data.version IS 'Version number for rollback capability';
COMMENT ON COLUMN portfolio_data.is_active IS 'Only one active version per key allowed';