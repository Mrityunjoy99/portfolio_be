import express from 'express';
import jwt from 'jsonwebtoken';
import { query } from '../config/database.js';

const router = express.Router();

// Middleware to validate presigned URL token
const validatePresignedToken = async (req, res, next) => {
  try {
    const { token } = req.query;
    const { filename } = req.params;
    
    if (!token) {
      return res.status(401).json({ error: 'Access token required' });
    }
    
    const secret = process.env.JWT_SECRET || 'your-jwt-secret-change-in-production';
    
    try {
      const decoded = jwt.verify(token, secret);
      
      // Validate token type and filename match
      if (decoded.type !== 'file-access' || decoded.filename !== filename) {
        return res.status(403).json({ error: 'Invalid access token' });
      }
      
      // Token is valid, proceed to serve file
      req.tokenData = decoded;
      next();
    } catch (jwtError) {
      if (jwtError.name === 'TokenExpiredError') {
        return res.status(401).json({ error: 'Access token expired' });
      }
      return res.status(403).json({ error: 'Invalid access token' });
    }
  } catch (error) {
    console.error('Token validation error:', error);
    res.status(500).json({ error: 'Token validation failed' });
  }
};

// Serve uploaded files from database with presigned URL validation
router.get('/secure/:filename', validatePresignedToken, async (req, res) => {
  try {
    const { filename } = req.params;
    const { download } = req.query; // Check if download is requested
    
    const result = await query(
      'SELECT filename, original_name, mime_type, file_data FROM uploads WHERE filename = $1',
      [filename]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'File not found' });
    }
    
    const file = result.rows[0];
    
    // Set appropriate headers
    const contentDisposition = download === 'true' 
      ? `attachment; filename="${file.original_name}"` 
      : `inline; filename="${file.original_name}"`;
    
    res.set({
      'Content-Type': file.mime_type,
      'Content-Disposition': contentDisposition,
      'Cache-Control': 'private, max-age=3600', // Cache for 1 hour only (private)
      'Content-Length': file.file_data.length.toString(),
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY'
    });
    
    // Send file data as Buffer
    res.end(Buffer.from(file.file_data));
  } catch (error) {
    console.error('File serving error:', error);
    res.status(500).json({ error: 'Failed to serve file' });
  }
});

// Health check for file service
router.get('/health', async (req, res) => {
  try {
    const result = await query('SELECT COUNT(*) as count FROM uploads');
    res.json({
      status: 'healthy',
      filesCount: parseInt(result.rows[0].count),
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('File service health check error:', error);
    res.status(500).json({
      status: 'unhealthy',
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

export default router;
