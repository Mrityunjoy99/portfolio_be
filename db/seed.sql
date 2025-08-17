-- Seed data for portfolio database
-- This file populates the database with initial data from the current hardcoded content

-- Insert profile data
INSERT INTO profile (
  name, title, tagline, bio, location, email, phone, 
  github_url, leetcode_url, linkedin_url
) VALUES (
  'Mrityunjoy Dey',
  'Software Engineer · Backend Developer',
  'Crafting scalable backend systems with precision, performance, and reliability.',
  'Experienced Backend Developer with over 2 years of expertise in building scalable services using Golang, Kafka, and AWS. Proven track record in enhancing API performance, implementing robust systems, and creating high-availability solutions that significantly improve operational efficiency.',
  'Bangalore, India',
  'mrityunjoydey1999@gmail.com',
  '+91 9064635902',
  'https://github.com/Mrityunjoy99',
  'https://leetcode.com/u/mrityunjoydey1999/',
  'https://www.linkedin.com/in/mrityunjoy-dey-44bb481a4/'
) ON CONFLICT DO NOTHING;

-- Insert skills data
INSERT INTO skills (name, category, icon_name, is_featured, sort_order) VALUES
  ('Golang', 'Backend', 'Code2', true, 1),
  ('Postgres', 'Database', 'Database', true, 2),
  ('Kafka', 'Messaging', 'Zap', true, 3),
  ('AWS', 'Cloud', 'Cloud', true, 4),
  ('Docker', 'DevOps', 'Server', true, 5),
  ('gRPC', 'API', 'Server', true, 6),
  ('Java', 'Backend', 'Code2', true, 7),
  ('Microservices', 'Architecture', 'Cpu', true, 8),
  ('Caching', 'Performance', 'Zap', true, 9),
  ('GitHub Actions', 'CI/CD', 'GitBranch', true, 10),
  ('DDD', 'Architecture', 'Shield', true, 11),
  ('Python', 'Backend', 'Code2', true, 12)
ON CONFLICT DO NOTHING;

-- Insert experience data
INSERT INTO experiences (company, position, start_date, end_date, sort_order) VALUES
  ('Slice', 'SDE-2', '2023-09-01', NULL, 1),
  ('Slice', 'SDE-1', '2022-06-01', '2023-09-01', 2)
ON CONFLICT DO NOTHING;

-- Get experience IDs for achievements
DO $$
DECLARE
  sde2_id UUID;
  sde1_id UUID;
BEGIN
  SELECT id INTO sde2_id FROM experiences WHERE position = 'SDE-2' AND company = 'Slice';
  SELECT id INTO sde1_id FROM experiences WHERE position = 'SDE-1' AND company = 'Slice';

  -- Insert achievements for SDE-2
  INSERT INTO achievements (experience_id, description, icon_name, metrics, sort_order) VALUES
    (sde2_id, 'Integrated Confluent Kafka into communication service, improving reliability and reducing API response time by 60×', 'Zap', '60× faster', 1),
    (sde2_id, 'Designed Transaction Orchestrator Service processing 500k+ transactions/day with 99.9% success rate', 'TrendingUp', '500k+ transactions/day, 99.9% success rate', 2),
    (sde2_id, 'Implemented real-time fraud & limit checks enhancing security', 'Shield', 'Real-time fraud detection', 3),
    (sde2_id, 'Re-engineered PDF generation service achieving 90% faster performance and cost-efficiency', 'TrendingUp', '90% faster', 4);

  -- Insert achievements for SDE-1
  INSERT INTO achievements (experience_id, description, icon_name, metrics, sort_order) VALUES
    (sde1_id, 'Built vendor onboarding & traffic distribution system, reducing onboarding time to 3 days', 'Building2', '3 days onboarding', 1),
    (sde1_id, 'Achieved 99.95% uptime for high-priority APIs', 'Shield', '99.95% uptime', 2),
    (sde1_id, 'Reduced DB costs by 90% via caching & bulk processing optimization', 'TrendingUp', '90% cost reduction', 3),
    (sde1_id, 'Created Golang DDD boilerplate & CI gating pipelines improving code quality & reducing review time by 40%', 'Zap', '40% faster reviews', 4);
END $$;

-- Insert projects data
INSERT INTO projects (
  title, slug, short_description, full_description, 
  github_url, publication_url, is_featured, sort_order, status
) VALUES
  (
    'Hand-drawn Circuit Component Recognition System',
    'circuit-recognition-system',
    'CNN-based system for recognizing hand-drawn circuit components with high accuracy. Published in Springer Nature, 2021.',
    'Deep learning system using Convolutional Neural Networks to recognize and classify hand-drawn circuit components. This research project achieved high accuracy in component recognition and was published in Springer Nature journal in 2021.',
    'https://github.com/Mrityunjoy99',
    '#',
    true,
    1,
    'published'
  ),
  (
    'Transaction Orchestrator Service',
    'transaction-orchestrator',
    'High-throughput distributed system processing 500k+ daily transactions with 99.9% success rate and real-time fraud detection.',
    'Enterprise-grade distributed system built with Golang and Kafka for processing high-volume financial transactions. Features real-time fraud detection, limit checks, and maintains 99.9% success rate while handling 500k+ transactions daily.',
    '#',
    NULL,
    true,
    2,
    'published'
  ),
  (
    'Golang DDD Boilerplate',
    'golang-ddd-boilerplate',
    'Domain-Driven Design boilerplate in Golang with CI/CD pipelines, reducing code review time by 40%.',
    'Open-source boilerplate project implementing Domain-Driven Design principles in Golang. Includes comprehensive CI/CD pipelines, testing frameworks, and development best practices that significantly improve code quality and reduce review time.',
    'https://github.com/Mrityunjoy99',
    NULL,
    false,
    3,
    'published'
  )
ON CONFLICT (slug) DO NOTHING;

-- Insert project technologies
DO $$
DECLARE
  circuit_project_id UUID;
  transaction_project_id UUID;
  golang_project_id UUID;
BEGIN
  SELECT id INTO circuit_project_id FROM projects WHERE slug = 'circuit-recognition-system';
  SELECT id INTO transaction_project_id FROM projects WHERE slug = 'transaction-orchestrator';
  SELECT id INTO golang_project_id FROM projects WHERE slug = 'golang-ddd-boilerplate';

  -- Technologies for Circuit Recognition System
  INSERT INTO project_technologies (project_id, technology) VALUES
    (circuit_project_id, 'Deep Learning'),
    (circuit_project_id, 'CNN'),
    (circuit_project_id, 'Computer Vision'),
    (circuit_project_id, 'Research');

  -- Technologies for Transaction Orchestrator
  INSERT INTO project_technologies (project_id, technology) VALUES
    (transaction_project_id, 'Golang'),
    (transaction_project_id, 'Microservices'),
    (transaction_project_id, 'Kafka'),
    (transaction_project_id, 'High Availability');

  -- Technologies for Golang DDD Boilerplate
  INSERT INTO project_technologies (project_id, technology) VALUES
    (golang_project_id, 'Golang'),
    (golang_project_id, 'DDD'),
    (golang_project_id, 'CI/CD'),
    (golang_project_id, 'Best Practices');
END $$;

-- Insert default admin user (password: admin123)
-- Note: This should be changed in production
-- Password hash for 'admin123' using bcrypt with salt rounds 12
INSERT INTO admin_users (username, email, password_hash) VALUES
  ('admin', 'admin@portfolio.com', '$2b$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMQJqhN8/LewdBdXfs2Stk5v9W')
ON CONFLICT DO NOTHING;