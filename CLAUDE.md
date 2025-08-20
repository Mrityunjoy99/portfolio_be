# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Portfolio Backend Context

## Project Overview

This is the backend API for Mrityunjoy Dey's portfolio website, built with Express.js and PostgreSQL. The API provides secure endpoints for managing portfolio content, user authentication, and contact form submissions.

## Tech Stack & Dependencies

- **Framework**: Express.js 5.1.0 (ES modules)
- **Database**: PostgreSQL with pg driver (8.16.3)
- **Authentication**: JWT (jsonwebtoken 9.0.2) + Passport.js with Google OAuth
- **Security**: Helmet, CORS, Rate Limiting, bcryptjs
- **File Handling**: Multer 2.0.2 with secure presigned URLs
- **Caching**: node-cache 5.1.2 with resilient refresh system
- **Validation**: express-validator 7.2.1
- **Session Management**: express-session 1.18.2
- **Development**: nodemon 3.1.10

## Project Structure

```
mrityunjoy-portfolio-be/
├── server/
│   ├── index.js              # Main server entry point
│   ├── config/
│   │   ├── database.js       # PostgreSQL connection & helpers
│   │   ├── passport.js       # Passport strategies (Google OAuth, JWT)
│   │   └── portfolio-cache.js # Enhanced caching system with node-cache
│   ├── middleware/
│   │   └── auth.js           # Authentication middleware
│   └── routes/
│       ├── auth.js           # Authentication endpoints
│       ├── profile.js        # Profile CRUD operations
│       ├── skills.js         # Skills management
│       ├── experiences.js    # Work experience
│       ├── projects.js       # Portfolio projects
│       ├── contact.js        # Contact form submissions
│       ├── admin.js          # Admin dashboard
│       ├── portfolio.js      # Bulk portfolio data endpoint
│       └── files.js          # Secure file handling
├── db/
│   ├── schema.sql            # Complete database schema
│   ├── seed.sql              # Initial data
│   ├── migration-*.sql       # Database migrations
└── scripts/
    └── setup-db.js           # Database initialization
```

## Database Schema

### Core Tables
- **profile**: Personal information (name, title, bio, social links)
- **skills**: Technical skills with categories and proficiency levels
- **experiences**: Work history with achievements
- **projects**: Portfolio projects with technologies and images
- **contact_submissions**: Contact form entries
- **admin_users**: Authentication and user management

### Key Features
- UUID primary keys throughout
- Proper foreign key relationships
- Indexed for performance
- Automatic timestamp triggers
- Soft deletes where appropriate

## API Architecture

### Public Endpoints
- `GET /api/health` - Health check
- `GET /api/profile` - Profile information
- `GET /api/skills` - Skills list (filterable by category/featured)
- `GET /api/experiences` - Work experience
- `GET /api/projects` - Portfolio projects
- `GET /api/portfolio/data` - Bulk portfolio data (cached)
- `POST /api/contact/submit` - Contact form submission

### Protected Endpoints (Admin Authentication Required)
- `POST /api/auth/login` - Admin login
- `GET /api/auth/me` - Current user info
- `POST /api/auth/change-password` - Password change
- All CRUD operations for skills, experiences, projects
- `GET /api/admin/dashboard/stats` - Dashboard statistics
- File upload and management via `/api/files`

### OAuth Integration
- `GET /api/auth/google` - Google OAuth initiation
- `GET /api/auth/google/callback` - OAuth callback
- Restricted to allowlist of admin emails

## Security Implementation

### Authentication
- JWT tokens with configurable expiration (default 7 days)
- Bcrypt password hashing (12 salt rounds)
- Session-based OAuth flow
- Token validation on every protected request

### Security Middleware
- **Helmet**: Security headers
- **CORS**: Configurable origins (localhost + production)
- **Rate Limiting**: 100 requests per 15 minutes per IP
- **Input Validation**: express-validator on all inputs
- **File Security**: Presigned URLs instead of direct file serving

### Database Security
- Parameterized queries prevent SQL injection
- Connection pooling with timeout controls
- SSL enforcement in production
- Transaction support for atomic operations

## Environment Configuration

### Required Variables
```bash
# Database
DATABASE_URL=postgresql://user:pass@host:port/db

# Authentication
JWT_SECRET=your-jwt-secret
SESSION_SECRET=your-session-secret

# Application
NODE_ENV=production
PORT=8000
FRONTEND_URL=https://your-frontend.com

# OAuth (Optional)
GOOGLE_CLIENT_ID=your-google-client-id
GOOGLE_CLIENT_SECRET=your-google-client-secret
GOOGLE_CALLBACK_URL=https://your-backend.com/api/auth/google/callback

# Portfolio Cache (Optional)
PORTFOLIO_CACHE_ENABLED=true           # Enable/disable cache (default: true in production)
PORTFOLIO_CACHE_REFRESH_INTERVAL=1800  # Cache refresh interval in seconds (default: 1800 = 30 minutes)
```

## Development Commands

```bash
npm install          # Install dependencies
npm run dev          # Start development server with nodemon
npm start            # Start production server
npm run setup-db     # Initialize database schema and seed data
```

### Development Workflow
1. Copy `.env.example` to `.env` and configure environment variables
2. Run `npm run setup-db` to initialize the database
3. Start development with `npm run dev`
4. Test endpoints manually using tools like Postman or curl
5. Check server logs for database queries and authentication events

### Local Development URLs
- Backend API: `http://localhost:8000`
- Health check: `http://localhost:8000/api/health`

## Deployment

### Render.com Configuration
- Auto-deployment from GitHub
- Environment variables in Render dashboard
- PostgreSQL database auto-provisioned
- Health check at `/api/health`
- Build: `npm install`
- Start: `npm start`

### Database Setup
1. Run migrations via `npm run setup-db`
2. Seed data automatically loaded
3. Admin user created via Google OAuth or manual insertion

## File Handling

Files are handled securely through:
- Multer middleware for uploads
- Database storage of file metadata
- Presigned URL access via JWT tokens
- No direct static file serving
- Access control through authentication

## Code Patterns

### Database Queries
```javascript
import { query } from '../config/database.js';
const result = await query('SELECT * FROM table WHERE id = $1', [id]);
```

### Authentication Middleware
```javascript
import { authenticate } from '../middleware/auth.js';
router.get('/protected', authenticate, (req, res) => {
  // req.user available here
});
```

### Validation Pattern
```javascript
import { body, validationResult } from 'express-validator';

router.post('/', [
  body('field').notEmpty().withMessage('Field is required'),
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ error: 'Validation failed', details: errors.array() });
  }
  // Process request
});
```

## Error Handling

- Global error middleware catches all errors
- Detailed error messages in development
- Generic error messages in production
- Database connection error handling
- JWT token error handling
- Validation error formatting

## Testing & Quality

**Note**: This project does not have automated tests. Testing is done manually.

To test the application:
1. Ensure database is running and accessible
2. Set environment variables in `.env`
3. Run `npm run setup-db` for fresh database
4. Start development server: `npm run dev`
5. Test endpoints using Postman or similar tool
6. Check logs for database query execution and errors

### Manual Testing Approach
- Use Postman or curl to test API endpoints
- Verify authentication flows with JWT tokens
- Test file upload functionality
- Check database state after operations
- Monitor server logs for errors and performance

## Key Files to Know

- `server/index.js` - Main server entry point and configuration
- `server/config/database.js` - Main query function and connection pool
- `server/config/portfolio-cache.js` - Enhanced caching system implementation
- `server/middleware/auth.js` - Authentication middleware
- `server/config/passport.js` - Admin email allowlist and OAuth strategies
- `server/routes/portfolio.js` - Bulk portfolio data endpoint with caching
- `db/schema.sql` - Complete database structure
- `render.yaml` - Deployment configuration

## Important Notes

1. **No TypeScript**: Pure JavaScript with ES modules
2. **No Testing Framework**: Manual testing only - no automated tests
3. **Security First**: All inputs validated, no direct file access
4. **OAuth Optional**: Google OAuth only works when configured
5. **Admin Only**: Most endpoints require authentication
6. **UUID IDs**: All entities use UUID primary keys
7. **Logging**: Database queries and authentication events logged
8. **CORS**: Configured for specific frontend origins
9. **Rate Limiting**: API protection against abuse (100 requests per 15 minutes)
10. **ES Modules**: Uses modern ES module syntax (`import/export`)

## Troubleshooting Common Issues

### Database Connection Issues
- Verify `DATABASE_URL` in `.env` file
- Ensure PostgreSQL is running locally
- Check network connectivity for remote databases
- Run `npm run setup-db` if tables are missing

### Authentication Problems
- Verify `JWT_SECRET` is set in environment
- Check token expiration (`JWT_EXPIRES_IN`)
- Ensure admin user exists in database
- For OAuth: verify Google Client ID/Secret configuration

### CORS Errors
- Update `FRONTEND_URL` in environment variables
- Check origin allowlist in server configuration
- Verify request headers include proper authentication

### File Upload Issues
- Check multer configuration and file size limits
- Verify proper authentication for file endpoints
- Ensure database has proper file metadata tables

## Enhanced In-Memory Cache System

### Architecture Overview
The portfolio backend implements a resilient, extensible caching layer using `node-cache` with individual key-based storage. The system is designed for single-container production deployments with enterprise-grade reliability.

### Key Features
- **Individual Key Caching**: Each database record cached separately (not as single blob)
- **DataProvider Architecture**: Unified interface for cache and database operations  
- **Smart Data Accessor**: Intelligent routing between cache/DB with fallback logic
- **Resilient Refresh**: Retry with exponential backoff, keeps stale data if DB fails
- **Write-Back Cache**: Granular cache updates on individual CRUD operations
- **Extensible Design**: Easy to add caching for other tables beyond `portfolio_data`

### Technical Implementation
```javascript
// Cache Keys Structure
'portfolio_data:profile'           // Profile data
'portfolio_data:skill:uuid'        // Individual skills
'portfolio_data:experience:uuid'   // Work experiences  
'portfolio_data:achievement:uuid'  // Experience achievements
'portfolio_data:project:uuid'      // Portfolio projects
'portfolio_data:project_tech:...'  // Project technologies

// Future extensibility
'contact_submissions:uuid'         // Other table caching
'admin_users:uuid'                 // User management
```

### Resilient Refresh Mechanism
- **Health Check**: Verifies database connectivity before cache invalidation
- **Safe Invalidation**: Only clears cache AFTER successful database fetch
- **Retry Logic**: 3 attempts with exponential backoff (1s, 2s, 4s)
- **Graceful Degradation**: Keeps existing cache if all retries fail
- **Periodic Recovery**: Retries every refresh interval until DB is healthy

### Configuration (Simplified)
Only two environment variables needed:
- `PORTFOLIO_CACHE_ENABLED`: Enable/disable caching (default: true in production)  
- `PORTFOLIO_CACHE_REFRESH_INTERVAL`: Auto-refresh interval in seconds (default: 1800)

### API Integration
- **`GET /api/portfolio/data`**: Smart routing (cache → DB fallback)
- **Admin CRUD Operations**: Individual key updates instead of full refresh
- **Cache Management**: Admin endpoints for cache status, clear, and refresh operations

### Performance Benefits
- **Individual Updates**: Only refresh changed items, not entire cache
- **Sub-millisecond Response**: Cached data served instantly
- **Reduced DB Load**: ~95% fewer database queries for public data
- **Memory Efficient**: Static cache without TTL/LRU overhead
- **High Availability**: Survives database outages with stale data

This backend is production-ready with comprehensive security, proper error handling, and scalable architecture suitable for a professional portfolio website.