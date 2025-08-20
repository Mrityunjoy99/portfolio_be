import express from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs/promises';
import { fileURLToPath } from 'url';
import { body, validationResult } from 'express-validator';
import jwt from 'jsonwebtoken';
import { query } from '../config/database.js';
import { authenticate } from '../middleware/auth.js';
import { getDashboardStats } from '../config/portfolio-data.js';
import { getCacheStatus, clearCache, invalidateCache, getAllCacheKeys } from '../config/portfolio-cache.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const router = express.Router();

// Configure multer for memory storage (files will be stored in database)
const storage = multer.memoryStorage();

const fileFilter = (req, file, cb) => {
  // Allow images and PDFs
  const allowedTypes = /jpeg|jpg|png|gif|webp|pdf/;
  const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
  const mimetype = allowedTypes.test(file.mimetype);

  if (mimetype && extname) {
    return cb(null, true);
  } else {
    cb(new Error('Only images (JPEG, JPG, PNG, GIF, WebP) and PDF files are allowed'));
  }
};

const upload = multer({
  storage: storage,
  limits: {
    fileSize: parseInt(process.env.MAX_FILE_SIZE) || 5 * 1024 * 1024, // 5MB default
  },
  fileFilter: fileFilter
});

// Helper function to generate unique filename
const generateUniqueFilename = (originalName) => {
  const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
  const ext = path.extname(originalName);
  const name = path.basename(originalName, ext).replace(/[^a-zA-Z0-9]/g, '-');
  return `${name}-${uniqueSuffix}${ext}`;
};

// Helper function to generate presigned URL
const generatePresignedUrl = (filename, expiresInHours = 24, forDownload = false) => {
  const secret = process.env.JWT_SECRET || 'your-jwt-secret-change-in-production';
  const payload = {
    filename: filename,
    type: 'file-access',
    exp: Math.floor(Date.now() / 1000) + (expiresInHours * 60 * 60) // expires in hours
  };
  
  const token = jwt.sign(payload, secret);
  const downloadParam = forDownload ? '&download=true' : '';
  return `/api/files/secure/${filename}?token=${token}${downloadParam}`;
};

// Get admin dashboard stats
router.get('/dashboard/stats', authenticate, async (req, res) => {
  try {
    const portfolioStats = await getDashboardStats();
    
    // Get contact stats (these tables remain unchanged)
    const contactStats = await Promise.all([
      query('SELECT COUNT(*) as count FROM contact_submissions'),
      query('SELECT COUNT(*) as count FROM contact_submissions WHERE status = $1', ['new']),
    ]);

    // Get recent activity from contact and portfolio data
    const recentActivity = await query(`
      SELECT 'contact' as type, name as title, created_at 
      FROM contact_submissions 
      WHERE created_at >= NOW() - INTERVAL '7 days'
      ORDER BY created_at DESC LIMIT 10
    `);

    const dashboardStats = {
      profile: {
        total: portfolioStats.totalStats.profile || 0
      },
      skills: {
        total: portfolioStats.totalStats.skill || 0,
        featured: portfolioStats.featuredSkills || 0
      },
      experiences: {
        total: portfolioStats.totalStats.experience || 0,
        achievements: portfolioStats.totalAchievements || 0
      },
      projects: {
        total: portfolioStats.totalStats.project || 0,
        published: portfolioStats.publishedProjects || 0,
        featured: portfolioStats.totalStats.project || 0 // All projects for now, can be refined
      },
      contact: {
        total: parseInt(contactStats[0].rows[0].count),
        unread: parseInt(contactStats[1].rows[0].count)
      },
      recentActivity: recentActivity.rows
    };

    res.json({ stats: dashboardStats });
  } catch (error) {
    console.error('Get dashboard stats error:', error);
    res.status(500).json({ error: 'Failed to get dashboard statistics' });
  }
});

// Cache management endpoints

// Get cache status and statistics
router.get('/cache/status', authenticate, async (req, res) => {
  try {
    const cacheStatus = getCacheStatus();
    res.json({ cache: cacheStatus });
  } catch (error) {
    console.error('Get cache status error:', error);
    res.status(500).json({ error: 'Failed to get cache status' });
  }
});

// Clear cache
router.post('/cache/clear', authenticate, async (req, res) => {
  try {
    clearCache();
    res.json({ message: 'Cache cleared successfully' });
  } catch (error) {
    console.error('Clear cache error:', error);
    res.status(500).json({ error: 'Failed to clear cache' });
  }
});

// Invalidate and refresh cache
router.post('/cache/refresh', authenticate, async (req, res) => {
  try {
    await invalidateCache();
    res.json({ message: 'Cache refreshed successfully' });
  } catch (error) {
    console.error('Refresh cache error:', error);
    res.status(500).json({ error: 'Failed to refresh cache' });
  }
});

// Get all cache keys and values
router.get('/cache/keys', authenticate, async (req, res) => {
  try {
    const cacheKeys = await getAllCacheKeys();
    res.json({ 
      keys: Object.keys(cacheKeys),
      data: cacheKeys,
      count: Object.keys(cacheKeys).length 
    });
  } catch (error) {
    console.error('Get cache keys error:', error);
    res.status(500).json({ error: 'Failed to get cache keys' });
  }
});

// Upload file endpoint
router.post('/upload', [authenticate, upload.single('file')], async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const filename = generateUniqueFilename(req.file.originalname);
    const uploadPath = `/uploads/${filename}`;
    
    // Store file in database
    const result = await query(
      `INSERT INTO uploads (filename, original_name, mime_type, file_size, file_data, upload_path, uploaded_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id, filename, original_name, mime_type, file_size, upload_path, created_at`,
      [
        filename,
        req.file.originalname,
        req.file.mimetype,
        req.file.size,
        req.file.buffer,
        uploadPath,
        req.user?.username || 'admin'
      ]
    );

    const uploadedFile = result.rows[0];
    
    res.json({
      message: 'File uploaded successfully',
      file: {
        id: uploadedFile.id,
        originalName: uploadedFile.original_name,
        filename: uploadedFile.filename,
        size: uploadedFile.file_size,
        mimetype: uploadedFile.mime_type,
        url: uploadedFile.upload_path,
        createdAt: uploadedFile.created_at
      }
    });
  } catch (error) {
    console.error('File upload error:', error);
    res.status(500).json({ error: 'Failed to upload file' });
  }
});

// Upload multiple files endpoint
router.post('/upload/multiple', [authenticate, upload.array('files', 10)], async (req, res) => {
  try {
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ error: 'No files uploaded' });
    }

    const uploadPromises = req.files.map(async (file) => {
      const filename = generateUniqueFilename(file.originalname);
      const uploadPath = `/uploads/${filename}`;
      
      const result = await query(
        `INSERT INTO uploads (filename, original_name, mime_type, file_size, file_data, upload_path, uploaded_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING id, filename, original_name, mime_type, file_size, upload_path, created_at`,
        [
          filename,
          file.originalname,
          file.mimetype,
          file.size,
          file.buffer,
          uploadPath,
          req.user?.username || 'admin'
        ]
      );
      
      const uploadedFile = result.rows[0];
      return {
        id: uploadedFile.id,
        originalName: uploadedFile.original_name,
        filename: uploadedFile.filename,
        size: uploadedFile.file_size,
        mimetype: uploadedFile.mime_type,
        url: uploadedFile.upload_path,
        createdAt: uploadedFile.created_at
      };
    });

    const uploadedFiles = await Promise.all(uploadPromises);
    
    res.json({
      message: `${uploadedFiles.length} files uploaded successfully`,
      files: uploadedFiles
    });
  } catch (error) {
    console.error('Multiple file upload error:', error);
    res.status(500).json({ error: 'Failed to upload files' });
  }
});

// Delete uploaded file
router.delete('/upload/:filename', authenticate, async (req, res) => {
  try {
    const { filename } = req.params;
    
    const result = await query(
      'DELETE FROM uploads WHERE filename = $1 RETURNING filename',
      [filename]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'File not found' });
    }
    
    res.json({ message: 'File deleted successfully' });
  } catch (error) {
    console.error('File deletion error:', error);
    res.status(500).json({ error: 'Failed to delete file' });
  }
});

// Get uploaded files list
router.get('/uploads', authenticate, async (req, res) => {
  try {
    const result = await query(
      `SELECT id, filename, original_name, mime_type, file_size, upload_path, 
              uploaded_by, created_at, updated_at
       FROM uploads 
       ORDER BY created_at DESC`
    );
    
    const files = result.rows.map(row => ({
      id: row.id,
      filename: row.filename,
      originalName: row.original_name,
      size: row.file_size,
      mimeType: row.mime_type,
      created: row.created_at,
      modified: row.updated_at,
      url: row.upload_path,
      uploadedBy: row.uploaded_by
    }));
    
    res.json({ files });
  } catch (error) {
    console.error('Get uploads error:', error);
    res.status(500).json({ error: 'Failed to get uploaded files' });
  }
});

// Generate presigned URL for file access
router.post('/uploads/presigned-url', authenticate, async (req, res) => {
  try {
    const { filename, expiresInHours = 24, forDownload = false } = req.body;
    
    if (!filename) {
      return res.status(400).json({ error: 'Filename is required' });
    }
    
    // Verify file exists
    const result = await query(
      'SELECT filename FROM uploads WHERE filename = $1',
      [filename]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'File not found' });
    }
    
    const presignedUrl = generatePresignedUrl(filename, expiresInHours, forDownload);
    const fullUrl = `${req.protocol}://${req.get('host')}${presignedUrl}`;
    
    res.json({
      presignedUrl: fullUrl,
      expiresIn: expiresInHours,
      expiresAt: new Date(Date.now() + (expiresInHours * 60 * 60 * 1000)).toISOString(),
      forDownload
    });
  } catch (error) {
    console.error('Presigned URL generation error:', error);
    res.status(500).json({ error: 'Failed to generate presigned URL' });
  }
});

// Note: File serving moved to dedicated secure route in files.js

// System health check
router.get('/health', authenticate, async (req, res) => {
  try {
    // Test database connection
    const dbTest = await query('SELECT NOW() as current_time');
    
    // Check uploads table
    const uploadsCount = await query('SELECT COUNT(*) as count FROM uploads');
    
    const health = {
      status: 'healthy',
      timestamp: new Date().toISOString(),
      database: {
        connected: true,
        serverTime: dbTest.rows[0].current_time
      },
      uploads: {
        storage: 'database',
        totalFiles: parseInt(uploadsCount.rows[0].count)
      },
      environment: process.env.NODE_ENV,
      uptime: process.uptime()
    };

    res.json({ health });
  } catch (error) {
    console.error('Health check error:', error);
    res.status(500).json({ 
      health: {
        status: 'unhealthy',
        timestamp: new Date().toISOString(),
        error: error.message
      }
    });
  }
});

// Export data (backup)
router.get('/export', authenticate, async (req, res) => {
  try {
    // Export from the new portfolio_data table
    const portfolioResult = await query(`SELECT * FROM portfolio_data WHERE is_active = TRUE ORDER BY type, created_at ASC`);
    
    // Also export other unchanged tables
    const otherTables = ['admin_users', 'contact_submissions', 'uploads', 'admin_settings'];
    const exportData = {
      portfolio_data: portfolioResult.rows
    };

    for (const table of otherTables) {
      try {
        const result = await query(`SELECT * FROM ${table} ORDER BY created_at ASC`);
        exportData[table] = result.rows;
      } catch (error) {
        // Table might not exist, skip it
        console.log(`Skipping table ${table}: ${error.message}`);
      }
    }

    res.json({
      exportedAt: new Date().toISOString(),
      version: '2.0', // Updated version for new schema
      schema: 'key-value',
      data: exportData
    });
  } catch (error) {
    console.error('Export data error:', error);
    res.status(500).json({ error: 'Failed to export data' });
  }
});

// Clear cache or perform maintenance tasks
router.post('/maintenance/clear-cache', authenticate, async (req, res) => {
  try {
    // This is a placeholder for cache clearing logic
    // In a real application, you might clear Redis cache, CDN cache, etc.
    
    res.json({ 
      message: 'Cache cleared successfully',
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Clear cache error:', error);
    res.status(500).json({ error: 'Failed to clear cache' });
  }
});

// Settings endpoints

// Get admin settings
router.get('/settings', authenticate, async (req, res) => {
  try {
    const userId = req.user.id;
    
    const result = await query(
      'SELECT id, user_id, theme, created_at, updated_at FROM admin_settings WHERE user_id = $1',
      [userId]
    );
    
    if (result.rows.length === 0) {
      // Create default settings if none exist
      const defaultSettings = await query(
        `INSERT INTO admin_settings (user_id) VALUES ($1) 
         RETURNING id, user_id, theme, created_at, updated_at`,
        [userId]
      );
      
      res.json({ settings: defaultSettings.rows[0] });
    } else {
      res.json({ settings: result.rows[0] });
    }
  } catch (error) {
    console.error('Get settings error:', error);
    res.status(500).json({ error: 'Failed to get settings' });
  }
});

// Update admin settings
router.put('/settings', [
  authenticate,
  body('theme').optional().isIn(['light', 'dark', 'system']).withMessage('Invalid theme'),
], async (req, res) => {
  try {
    // Check validation errors
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ 
        error: 'Validation failed', 
        details: errors.array() 
      });
    }

    const userId = req.user.id;
    const { theme } = req.body;

    if (!theme) {
      return res.status(400).json({ error: 'Theme is required' });
    }

    const result = await query(
      `UPDATE admin_settings 
       SET theme = $1, updated_at = NOW()
       WHERE user_id = $2
       RETURNING id, user_id, theme, created_at, updated_at`,
      [theme, userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Settings not found' });
    }

    res.json({ 
      message: 'Theme updated successfully',
      settings: result.rows[0] 
    });
  } catch (error) {
    console.error('Update settings error:', error);
    res.status(500).json({ error: 'Failed to update settings' });
  }
});

// Reset settings to defaults
router.post('/settings/reset', authenticate, async (req, res) => {
  try {
    const userId = req.user.id;
    
    const result = await query(
      `UPDATE admin_settings SET
        theme = 'system',
        updated_at = NOW()
      WHERE user_id = $1
      RETURNING id, user_id, theme, created_at, updated_at`,
      [userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Settings not found' });
    }

    res.json({ 
      message: 'Theme reset to default successfully',
      settings: result.rows[0] 
    });
  } catch (error) {
    console.error('Reset settings error:', error);
    res.status(500).json({ error: 'Failed to reset settings' });
  }
});

export default router;