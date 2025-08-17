import express from 'express';
import { body, validationResult } from 'express-validator';
import rateLimit from 'express-rate-limit';
import { query } from '../config/database.js';
import { authenticate } from '../middleware/auth.js';

const router = express.Router();

// Rate limiting for contact form submissions
const contactLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 3, // limit each IP to 3 contact form submissions per windowMs
  message: {
    error: 'Too many contact form submissions from this IP, please try again later.',
    retryAfter: 15 * 60 * 1000
  },
  standardHeaders: true,
  legacyHeaders: false,
});

// Submit contact form (public endpoint with rate limiting)
router.post('/submit', [
  contactLimiter,
  body('name').trim().isLength({ min: 2, max: 100 }).withMessage('Name must be between 2 and 100 characters'),
  body('email').isEmail().normalizeEmail().withMessage('Valid email is required'),
  body('subject').optional().trim().isLength({ max: 200 }).withMessage('Subject must be less than 200 characters'),
  body('message').trim().isLength({ min: 10, max: 2000 }).withMessage('Message must be between 10 and 2000 characters')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ 
        error: 'Validation failed', 
        details: errors.array() 
      });
    }

    const { name, email, subject, message } = req.body;
    
    // Get client IP and user agent for tracking
    const clientIP = req.ip || req.connection.remoteAddress || req.socket.remoteAddress;
    const userAgent = req.get('User-Agent');

    // Save to database
    const result = await query(
      `INSERT INTO contact_submissions (name, email, subject, message, ip_address, user_agent)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, created_at`,
      [name, email, subject, message, clientIP, userAgent]
    );

    // TODO: Send email notification to admin
    // This would typically use a service like SendGrid, AWS SES, or Nodemailer
    console.log('New contact form submission:', {
      id: result.rows[0].id,
      name,
      email,
      subject: subject || 'No subject',
      timestamp: result.rows[0].created_at
    });

    res.status(201).json({ 
      message: 'Thank you for your message! I\'ll get back to you as soon as possible.',
      submissionId: result.rows[0].id
    });
  } catch (error) {
    console.error('Contact form submission error:', error);
    res.status(500).json({ error: 'Failed to submit contact form. Please try again later.' });
  }
});

// Get all contact submissions (admin only)
router.get('/submissions', authenticate, async (req, res) => {
  try {
    const { status, limit = 50, offset = 0 } = req.query;
    
    let queryText = 'SELECT * FROM contact_submissions';
    let queryParams = [];
    let conditions = [];

    if (status) {
      conditions.push(`status = $${queryParams.length + 1}`);
      queryParams.push(status);
    }

    if (conditions.length > 0) {
      queryText += ' WHERE ' + conditions.join(' AND ');
    }

    queryText += ` ORDER BY created_at DESC LIMIT $${queryParams.length + 1} OFFSET $${queryParams.length + 2}`;
    queryParams.push(parseInt(limit), parseInt(offset));

    const result = await query(queryText, queryParams);

    // Get total count for pagination
    let countQuery = 'SELECT COUNT(*) as total FROM contact_submissions';
    let countParams = [];
    
    if (status) {
      countQuery += ' WHERE status = $1';
      countParams.push(status);
    }

    const countResult = await query(countQuery, countParams);
    const total = parseInt(countResult.rows[0].total);

    res.json({ 
      submissions: result.rows,
      pagination: {
        total,
        limit: parseInt(limit),
        offset: parseInt(offset),
        hasMore: (parseInt(offset) + parseInt(limit)) < total
      }
    });
  } catch (error) {
    console.error('Get contact submissions error:', error);
    res.status(500).json({ error: 'Failed to get contact submissions' });
  }
});

// Get contact submission by ID (admin only)
router.get('/submissions/:id', authenticate, async (req, res) => {
  try {
    const { id } = req.params;
    
    const result = await query(
      'SELECT * FROM contact_submissions WHERE id = $1',
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Contact submission not found' });
    }

    res.json({ submission: result.rows[0] });
  } catch (error) {
    console.error('Get contact submission error:', error);
    res.status(500).json({ error: 'Failed to get contact submission' });
  }
});

// Update contact submission status (admin only)
router.patch('/submissions/:id/status', [
  authenticate,
  body('status').isIn(['new', 'read', 'replied']).withMessage('Status must be new, read, or replied')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ 
        error: 'Validation failed', 
        details: errors.array() 
      });
    }

    const { id } = req.params;
    const { status } = req.body;

    const result = await query(
      'UPDATE contact_submissions SET status = $1 WHERE id = $2 RETURNING *',
      [status, id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Contact submission not found' });
    }

    res.json({ 
      message: 'Contact submission status updated successfully',
      submission: result.rows[0] 
    });
  } catch (error) {
    console.error('Update contact submission status error:', error);
    res.status(500).json({ error: 'Failed to update contact submission status' });
  }
});

// Delete contact submission (admin only)
router.delete('/submissions/:id', authenticate, async (req, res) => {
  try {
    const { id } = req.params;

    const result = await query(
      'DELETE FROM contact_submissions WHERE id = $1 RETURNING *',
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Contact submission not found' });
    }

    res.json({ 
      message: 'Contact submission deleted successfully',
      submission: result.rows[0] 
    });
  } catch (error) {
    console.error('Delete contact submission error:', error);
    res.status(500).json({ error: 'Failed to delete contact submission' });
  }
});

// Bulk update contact submission status (admin only)
router.patch('/submissions/bulk/status', [
  authenticate,
  body('ids').isArray().withMessage('IDs must be an array'),
  body('ids.*').isUUID().withMessage('Each ID must be a valid UUID'),
  body('status').isIn(['new', 'read', 'replied']).withMessage('Status must be new, read, or replied')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ 
        error: 'Validation failed', 
        details: errors.array() 
      });
    }

    const { ids, status } = req.body;

    if (ids.length === 0) {
      return res.status(400).json({ error: 'At least one ID is required' });
    }

    // Create placeholders for the IN clause
    const placeholders = ids.map((_, index) => `$${index + 2}`).join(', ');
    
    const result = await query(
      `UPDATE contact_submissions SET status = $1 WHERE id IN (${placeholders}) RETURNING id`,
      [status, ...ids]
    );

    res.json({ 
      message: `${result.rows.length} contact submissions updated successfully`,
      updatedIds: result.rows.map(row => row.id)
    });
  } catch (error) {
    console.error('Bulk update contact submissions error:', error);
    res.status(500).json({ error: 'Failed to update contact submissions' });
  }
});

// Get contact statistics (admin only)
router.get('/stats', authenticate, async (req, res) => {
  try {
    const stats = await Promise.all([
      query('SELECT COUNT(*) as count FROM contact_submissions'),
      query('SELECT COUNT(*) as count FROM contact_submissions WHERE status = $1', ['new']),
      query('SELECT COUNT(*) as count FROM contact_submissions WHERE status = $1', ['read']),
      query('SELECT COUNT(*) as count FROM contact_submissions WHERE status = $1', ['replied']),
      query(`SELECT DATE_TRUNC('day', created_at) as date, COUNT(*) as count 
             FROM contact_submissions 
             WHERE created_at >= NOW() - INTERVAL '30 days'
             GROUP BY DATE_TRUNC('day', created_at)
             ORDER BY date DESC`)
    ]);

    res.json({
      stats: {
        total: parseInt(stats[0].rows[0].count),
        new: parseInt(stats[1].rows[0].count),
        read: parseInt(stats[2].rows[0].count),
        replied: parseInt(stats[3].rows[0].count),
        dailyStats: stats[4].rows.map(row => ({
          date: row.date,
          count: parseInt(row.count)
        }))
      }
    });
  } catch (error) {
    console.error('Get contact stats error:', error);
    res.status(500).json({ error: 'Failed to get contact statistics' });
  }
});

export default router;