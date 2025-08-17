import express from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs/promises';
import { fileURLToPath } from 'url';
import { body, validationResult } from 'express-validator';
import jwt from 'jsonwebtoken';
import { query } from '../config/database.js';
import { authenticate } from '../middleware/auth.js';

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
    const stats = await Promise.all([
      // Profile stats
      query('SELECT COUNT(*) as count FROM profile'),
      
      // Skills stats
      query('SELECT COUNT(*) as count FROM skills'),
      query('SELECT COUNT(*) as count FROM skills WHERE is_featured = true'),
      
      // Experience stats
      query('SELECT COUNT(*) as count FROM experiences'),
      query('SELECT COUNT(*) as count FROM achievements'),
      
      // Project stats
      query('SELECT COUNT(*) as count FROM projects'),
      query('SELECT COUNT(*) as count FROM projects WHERE status = $1', ['published']),
      query('SELECT COUNT(*) as count FROM projects WHERE is_featured = true'),
      
      // Contact stats
      query('SELECT COUNT(*) as count FROM contact_submissions'),
      query('SELECT COUNT(*) as count FROM contact_submissions WHERE status = $1', ['new']),
      
      // Recent activity
      query(`SELECT 'contact' as type, name as title, created_at 
             FROM contact_submissions 
             WHERE created_at >= NOW() - INTERVAL '7 days'
             UNION ALL
             SELECT 'project' as type, title, created_at 
             FROM projects 
             WHERE created_at >= NOW() - INTERVAL '7 days'
             ORDER BY created_at DESC LIMIT 10`)
    ]);

    const dashboardStats = {
      profile: {
        total: parseInt(stats[0].rows[0].count)
      },
      skills: {
        total: parseInt(stats[1].rows[0].count),
        featured: parseInt(stats[2].rows[0].count)
      },
      experiences: {
        total: parseInt(stats[3].rows[0].count),
        achievements: parseInt(stats[4].rows[0].count)
      },
      projects: {
        total: parseInt(stats[5].rows[0].count),
        published: parseInt(stats[6].rows[0].count),
        featured: parseInt(stats[7].rows[0].count)
      },
      contact: {
        total: parseInt(stats[8].rows[0].count),
        unread: parseInt(stats[9].rows[0].count)
      },
      recentActivity: stats[10].rows
    };

    res.json({ stats: dashboardStats });
  } catch (error) {
    console.error('Get dashboard stats error:', error);
    res.status(500).json({ error: 'Failed to get dashboard statistics' });
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
    const tables = ['profile', 'skills', 'experiences', 'achievements', 'projects', 'project_technologies', 'project_images'];
    const exportData = {};

    for (const table of tables) {
      const result = await query(`SELECT * FROM ${table} ORDER BY created_at ASC`);
      exportData[table] = result.rows;
    }

    res.json({
      exportedAt: new Date().toISOString(),
      version: '1.0',
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