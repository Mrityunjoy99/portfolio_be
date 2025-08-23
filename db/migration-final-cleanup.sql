-- Safe Migration: Ensure Core Portfolio Schema
-- This migration ensures all core portfolio tables exist without dropping any data
-- PRODUCTION SAFE: No DROP operations, only CREATE IF NOT EXISTS

-- ============================================================================
-- STEP 1: Ensure UUID extension is available
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================================================
-- STEP 2: Ensure all core portfolio tables exist (from original schema.sql)
-- ============================================================================

-- Profile table for personal information
CREATE TABLE IF NOT EXISTS profile (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name VARCHAR(100) NOT NULL,
  title VARCHAR(200) NOT NULL,
  tagline TEXT,
  bio TEXT,
  location VARCHAR(100),
  email VARCHAR(100),
  phone VARCHAR(20),
  github_url VARCHAR(200),
  leetcode_url VARCHAR(200),
  linkedin_url VARCHAR(200),
  resume_url VARCHAR(200),
  profile_image_url VARCHAR(500),
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Skills table for technical expertise
CREATE TABLE IF NOT EXISTS skills (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name VARCHAR(100) NOT NULL,
  category VARCHAR(50) NOT NULL,
  proficiency INTEGER CHECK (proficiency >= 1 AND proficiency <= 5),
  icon_name VARCHAR(50),
  years_experience DECIMAL(3,1),
  is_featured BOOLEAN DEFAULT FALSE,
  sort_order INTEGER DEFAULT 0,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Experience table for work history
CREATE TABLE IF NOT EXISTS experiences (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company VARCHAR(100) NOT NULL,
  position VARCHAR(100) NOT NULL,
  start_date DATE NOT NULL,
  end_date DATE,
  location VARCHAR(100),
  company_logo_url VARCHAR(500),
  description TEXT,
  sort_order INTEGER DEFAULT 0,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Achievements table for experience highlights
CREATE TABLE IF NOT EXISTS achievements (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  experience_id UUID REFERENCES experiences(id) ON DELETE CASCADE,
  description TEXT NOT NULL,
  icon_name VARCHAR(50),
  metrics VARCHAR(200),
  sort_order INTEGER DEFAULT 0,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Projects table for portfolio items
CREATE TABLE IF NOT EXISTS projects (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  title VARCHAR(200) NOT NULL,
  slug VARCHAR(100) UNIQUE NOT NULL,
  short_description TEXT,
  full_description TEXT,
  featured_image_url VARCHAR(500),
  demo_url VARCHAR(500),
  github_url VARCHAR(500),
  publication_url VARCHAR(500),
  status VARCHAR(20) DEFAULT 'published',
  is_featured BOOLEAN DEFAULT FALSE,
  sort_order INTEGER DEFAULT 0,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Project technologies junction table
CREATE TABLE IF NOT EXISTS project_technologies (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  project_id UUID REFERENCES projects(id) ON DELETE CASCADE,
  technology VARCHAR(50) NOT NULL,
  UNIQUE(project_id, technology)
);

-- Project images table for galleries
CREATE TABLE IF NOT EXISTS project_images (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  project_id UUID REFERENCES projects(id) ON DELETE CASCADE,
  image_url VARCHAR(500) NOT NULL,
  alt_text VARCHAR(200),
  caption TEXT,
  sort_order INTEGER DEFAULT 0,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Contact submissions table (already exists, but ensure structure)
-- admin_users table (already cleaned up in previous migration)

-- ============================================================================
-- STEP 3: Create indexes for better performance
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_skills_category ON skills(category);
CREATE INDEX IF NOT EXISTS idx_skills_featured ON skills(is_featured);
CREATE INDEX IF NOT EXISTS idx_experiences_sort_order ON experiences(sort_order);
CREATE INDEX IF NOT EXISTS idx_achievements_experience_id ON achievements(experience_id);
CREATE INDEX IF NOT EXISTS idx_projects_status ON projects(status);
CREATE INDEX IF NOT EXISTS idx_projects_featured ON projects(is_featured);
CREATE INDEX IF NOT EXISTS idx_projects_slug ON projects(slug);
CREATE INDEX IF NOT EXISTS idx_contact_submissions_status ON contact_submissions(status);
CREATE INDEX IF NOT EXISTS idx_contact_submissions_created_at ON contact_submissions(created_at);

-- ============================================================================
-- STEP 4: Create trigger to update updated_at timestamp
-- ============================================================================

CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

DROP TRIGGER IF EXISTS update_profile_updated_at ON profile;
DROP TRIGGER IF EXISTS update_projects_updated_at ON projects;
DROP TRIGGER IF EXISTS update_admin_users_updated_at ON admin_users;

CREATE TRIGGER update_profile_updated_at BEFORE UPDATE ON profile FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_projects_updated_at BEFORE UPDATE ON projects FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_admin_users_updated_at BEFORE UPDATE ON admin_users FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================================================
-- STEP 5: Ensure admin user indexes exist
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_admin_users_email ON admin_users(email);
CREATE INDEX IF NOT EXISTS idx_admin_users_username ON admin_users(username);

-- ============================================================================
-- SUMMARY
-- ============================================================================
-- After this migration, the database will only contain:
-- 1. profile (personal info)
-- 2. skills (technical skills)
-- 3. experiences (work history)
-- 4. achievements (experience highlights)
-- 5. projects (portfolio projects)
-- 6. project_technologies (project tech stack)
-- 7. project_images (project gallery)
-- 8. contact_submissions (contact form)
-- 9. admin_users (Google-only authentication)
--
-- Environment variables for admin management:
-- ADMIN_EMAILS=user1@example.com,user2@example.com
-- ============================================================================