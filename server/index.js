import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import rateLimit from 'express-rate-limit';
import session from 'express-session';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import passport from './config/passport.js';
import { initializeCache, shutdownCache } from './config/portfolio-cache.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config();

const app = express();
const PORT = process.env.PORT || 8000;

// Security middleware
app.use(helmet({
  crossOriginResourcePolicy: { policy: "cross-origin" }
}));

// Rate limiting - more permissive for normal usage
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 500, // limit each IP to 500 requests per 15 minutes (5x more permissive)
  message: 'Too many requests from this IP, please try again later.',
  standardHeaders: true, // Return rate limit info in the `RateLimit-*` headers
  legacyHeaders: false, // Disable the `X-RateLimit-*` headers
});
app.use('/api/', limiter);

// Enhanced CORS configuration with multiple origin support
const getAllowedOrigins = () => {
  const defaultOrigins = [
    'http://localhost:8080',
  ];
  
  // Primary frontend URL from environment
  if (process.env.FRONTEND_URL) {
    defaultOrigins.push(process.env.FRONTEND_URL);
  }
  
  // Additional origins from environment (comma-separated)
  if (process.env.ADDITIONAL_ORIGINS) {
    const additionalOrigins = process.env.ADDITIONAL_ORIGINS
      .split(',')
      .map(origin => origin.trim())
      .filter(origin => origin.length > 0);
    defaultOrigins.push(...additionalOrigins);
  }
  
  return [...new Set(defaultOrigins)];
};

const corsOptions = {
  origin: (origin, callback) => {
    const allowedOrigins = getAllowedOrigins();
    
    // Allow requests with no origin (mobile apps, Postman, etc.)
    if (!origin) return callback(null, true);
    
    // Check against allowed origins
    if (allowedOrigins.includes(origin)) {
      return callback(null, true);
    }
    
    // Log rejected origins in development for debugging
    if (process.env.NODE_ENV !== 'production') {
      console.log(`CORS: Rejected origin: ${origin}`);
      console.log('Allowed origins:', allowedOrigins);
    }
    
    const err = new Error('Not allowed by CORS');
    err.status = 403;
    callback(err);
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Origin', 'X-Requested-With', 'Content-Type', 'Accept', 'Authorization'],
  optionsSuccessStatus: 200 // For legacy browser support
};

app.use(cors(corsOptions));

// Body parsing middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Session middleware for OAuth
app.use(session({
  secret: process.env.SESSION_SECRET || 'your-session-secret-change-in-production',
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: process.env.NODE_ENV === 'production',
    maxAge: 1000 * 60 * 60 * 24 // 24 hours
  }
}));

// Initialize passport
app.use(passport.initialize());
app.use(passport.session());

// Logging
app.use(morgan('combined'));

// Disable caching during development to prevent 304 responses
if (process.env.NODE_ENV !== 'production') {
  app.use((req, res, next) => {
    res.set({
      'Cache-Control': 'no-cache, no-store, must-revalidate',
      'Pragma': 'no-cache',
      'Expires': '0'
    });
    next();
  });
}

// Note: Files are now served securely from database via presigned URLs
// Routes: /api/files/secure/:filename?token=<jwt_token>
// No static file serving needed for uploads

// API Routes
import authRoutes from './routes/auth.js';
import profileRoutes from './routes/profile.js';
import skillsRoutes from './routes/skills.js';
import experiencesRoutes from './routes/experiences.js';
import projectsRoutes from './routes/projects.js';
import contactRoutes from './routes/contact.js';
import adminRoutes from './routes/admin.js';
import filesRoutes from './routes/files.js';
import publicRoutes from './routes/public.js';
import portfolioRoutes from './routes/portfolio.js';
import analyticsRoutes from './routes/analytics.js';

app.use('/api/auth', authRoutes);
app.use('/api/profile', profileRoutes);
app.use('/api/skills', skillsRoutes);
app.use('/api/experiences', experiencesRoutes);
app.use('/api/projects', projectsRoutes);
app.use('/api/contact', contactRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/files', filesRoutes);
app.use('/api/portfolio', portfolioRoutes);
app.use('/api/analytics', analyticsRoutes);
app.use('/api', publicRoutes);

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'OK', 
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV 
  });
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ 
    error: 'Something went wrong!',
    message: process.env.NODE_ENV === 'development' ? err.message : 'Internal server error'
  });
});

// 404 handler for all unmatched routes
app.use((req, res) => {
  res.status(404).json({ error: 'Route not found' });
});

// Start server
const server = app.listen(PORT, async () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`📊 Environment: ${process.env.NODE_ENV}`);
  console.log(`🔗 API URL: http://localhost:${PORT}/api`);
  
  // Initialize portfolio cache
  try {
    await initializeCache();
    console.log('✅ Portfolio cache initialized');
  } catch (error) {
    console.error('❌ Failed to initialize portfolio cache:', error);
    // Continue running even if cache fails to initialize
  }
});

// Graceful shutdown handling
let shutdownInProgress = false;

const gracefulShutdown = (signal) => {
  if (shutdownInProgress) {
    console.log(`\n🔴 Received ${signal} again, force exiting...`);
    process.exit(1);
  }
  
  shutdownInProgress = true;
  console.log(`\n🛑 Received ${signal}, starting graceful shutdown...`);
  
  // Close the HTTP server first
  server.close((err) => {
    if (err) {
      console.error('❌ Error closing HTTP server:', err);
      process.exit(1);
    }
    
    console.log('✅ HTTP server closed');
    
    // Shutdown cache
    try {
      shutdownCache();
      console.log('✅ Graceful shutdown complete');
      process.exit(0);
    } catch (error) {
      console.error('❌ Error during cache shutdown:', error);
      process.exit(1);
    }
  });
  
  // Force exit after 10 seconds
  setTimeout(() => {
    console.log('🔴 Force exiting after 10 seconds...');
    process.exit(1);
  }, 10000);
};

// Handle process termination signals
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

// Handle unexpected exits
process.on('uncaughtException', (error) => {
  console.error('💥 Uncaught Exception:', error);
  gracefulShutdown('uncaughtException');
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('💥 Unhandled Rejection at:', promise, 'reason:', reason);
  gracefulShutdown('unhandledRejection');
});

export default app;