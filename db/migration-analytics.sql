-- Migration: Create analytics tables for visitor tracking
-- This creates tables to track visitor analytics without requiring consent
-- PRODUCTION SAFE: Only creates new tables, no existing data affected

-- Enable UUID extension if not already enabled
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Main visitor sessions table
CREATE TABLE IF NOT EXISTS visitor_analytics (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  session_id VARCHAR(255) UNIQUE NOT NULL, -- Client-generated session ID
  ip_address INET,
  user_agent TEXT,
  -- Geographic data (from IP)
  country VARCHAR(100),
  city VARCHAR(100),
  region VARCHAR(100),
  -- Device & Browser info
  device_type VARCHAR(50), -- mobile, tablet, desktop
  browser_name VARCHAR(100),
  browser_version VARCHAR(50),
  os_name VARCHAR(100),
  screen_width INTEGER,
  screen_height INTEGER,
  -- Session tracking
  first_visit TIMESTAMP DEFAULT NOW(),
  last_activity TIMESTAMP DEFAULT NOW(),
  session_duration INTEGER DEFAULT 0, -- seconds
  page_views INTEGER DEFAULT 1,
  is_bounce BOOLEAN DEFAULT TRUE,
  -- Traffic source
  referrer_url TEXT,
  referrer_domain VARCHAR(255),
  utm_source VARCHAR(100),
  utm_medium VARCHAR(100),
  utm_campaign VARCHAR(100),
  -- Additional data as JSONB for flexibility
  additional_data JSONB,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Page view events
CREATE TABLE IF NOT EXISTS page_views (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  session_id VARCHAR(255) REFERENCES visitor_analytics(session_id),
  page_path VARCHAR(500) NOT NULL,
  page_title VARCHAR(500),
  view_duration INTEGER, -- seconds spent on page
  scroll_depth INTEGER, -- percentage 0-100
  entry_page BOOLEAN DEFAULT FALSE,
  exit_page BOOLEAN DEFAULT FALSE,
  timestamp TIMESTAMP DEFAULT NOW()
);

-- User interaction events  
CREATE TABLE IF NOT EXISTS user_events (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  session_id VARCHAR(255) REFERENCES visitor_analytics(session_id),
  event_type VARCHAR(100) NOT NULL, -- 'resume_download', 'social_click', 'contact_submit', etc.
  event_category VARCHAR(100), -- 'engagement', 'download', 'navigation'
  element_id VARCHAR(100), -- DOM element identifier
  element_text VARCHAR(500), -- button text, link text
  target_url TEXT, -- for link clicks
  page_path VARCHAR(500), -- where the event occurred
  additional_data JSONB, -- flexible data storage
  timestamp TIMESTAMP DEFAULT NOW()
);

-- Performance metrics
CREATE TABLE IF NOT EXISTS performance_metrics (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  session_id VARCHAR(255) REFERENCES visitor_analytics(session_id),
  page_path VARCHAR(500) NOT NULL,
  load_time INTEGER, -- milliseconds
  dom_ready_time INTEGER,
  first_paint_time INTEGER,
  largest_contentful_paint INTEGER,
  cumulative_layout_shift DECIMAL(5,4),
  timestamp TIMESTAMP DEFAULT NOW()
);

-- Indexes for efficient querying
CREATE INDEX IF NOT EXISTS idx_visitor_analytics_session ON visitor_analytics(session_id);
CREATE INDEX IF NOT EXISTS idx_visitor_analytics_created_at ON visitor_analytics(created_at);
CREATE INDEX IF NOT EXISTS idx_visitor_analytics_country ON visitor_analytics(country);
CREATE INDEX IF NOT EXISTS idx_visitor_analytics_device_type ON visitor_analytics(device_type);
CREATE INDEX IF NOT EXISTS idx_visitor_analytics_referrer_domain ON visitor_analytics(referrer_domain);

CREATE INDEX IF NOT EXISTS idx_page_views_session ON page_views(session_id);
CREATE INDEX IF NOT EXISTS idx_page_views_timestamp ON page_views(timestamp);
CREATE INDEX IF NOT EXISTS idx_page_views_page_path ON page_views(page_path);

CREATE INDEX IF NOT EXISTS idx_user_events_session ON user_events(session_id);
CREATE INDEX IF NOT EXISTS idx_user_events_type ON user_events(event_type);
CREATE INDEX IF NOT EXISTS idx_user_events_timestamp ON user_events(timestamp);

CREATE INDEX IF NOT EXISTS idx_performance_metrics_session ON performance_metrics(session_id);
CREATE INDEX IF NOT EXISTS idx_performance_metrics_timestamp ON performance_metrics(timestamp);

-- Create trigger to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_visitor_analytics_updated_at 
  BEFORE UPDATE ON visitor_analytics 
  FOR EACH ROW 
  EXECUTE FUNCTION update_updated_at_column();

-- Add comments for documentation
COMMENT ON TABLE visitor_analytics IS 'Main visitor sessions table for analytics tracking';
COMMENT ON TABLE page_views IS 'Page view events tracking';
COMMENT ON TABLE user_events IS 'User interaction events tracking';
COMMENT ON TABLE performance_metrics IS 'Page performance metrics tracking';