import express from 'express';
import { body, validationResult } from 'express-validator';
import { query } from '../config/database.js';
import { authenticate, optionalAuth } from '../middleware/auth.js';

const router = express.Router();

// Get profile data (public endpoint)
router.get('/', async (req, res) => {
  try {
    const result = await query(
      'SELECT * FROM profile ORDER BY created_at DESC LIMIT 1'
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Profile not found' });
    }

    res.json({ profile: result.rows[0] });
  } catch (error) {
    console.error('Get profile error:', error);
    res.status(500).json({ error: 'Failed to get profile' });
  }
});

// Update profile data (admin only)
router.put('/', [
  authenticate,
  body('name').trim().notEmpty().withMessage('Name is required'),
  body('title').trim().notEmpty().withMessage('Title is required'),
  body('email').isEmail().withMessage('Valid email is required'),
  body('phone').optional().trim(),
  body('location').optional().trim(),
  body('tagline').optional().trim(),
  body('bio').optional().trim(),
  body('github_url').optional().custom((value) => {
    if (!value || value === null || value === '') return true;
    try {
      new URL(value);
      return true;
    } catch {
      throw new Error('GitHub URL must be valid');
    }
  }),
  body('leetcode_url').optional().custom((value) => {
    if (!value || value === null || value === '') return true;
    try {
      new URL(value);
      return true;
    } catch {
      throw new Error('LeetCode URL must be valid');
    }
  }),
  body('linkedin_url').optional().custom((value) => {
    if (!value || value === null || value === '') return true;
    try {
      new URL(value);
      return true;
    } catch {
      throw new Error('LinkedIn URL must be valid');
    }
  }),
  body('resume_url').optional().custom((value) => {
    if (!value || value === null || value === '') return true;
    try {
      new URL(value);
      return true;
    } catch {
      throw new Error('Resume URL must be valid');
    }
  }),
  body('profile_image_url').optional().custom((value) => {
    if (!value || value === null || value === '') return true;
    try {
      new URL(value);
      return true;
    } catch {
      throw new Error('Profile image URL must be valid');
    }
  })
], async (req, res) => {
  try {
    console.log('📝 Profile update request body:', JSON.stringify(req.body, null, 2));
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      console.log('❌ Validation errors:', JSON.stringify(errors.array(), null, 2));
      return res.status(400).json({ 
        error: 'Validation failed', 
        details: errors.array() 
      });
    }

    const {
      name,
      title,
      tagline,
      bio,
      location,
      email,
      phone,
      github_url,
      leetcode_url,
      linkedin_url,
      resume_url,
      profile_image_url
    } = req.body;

    // Check if profile exists
    const existingProfile = await query('SELECT id FROM profile LIMIT 1');

    let result;
    if (existingProfile.rows.length === 0) {
      // Create new profile
      result = await query(
        `INSERT INTO profile (
          name, title, tagline, bio, location, email, phone,
          github_url, leetcode_url, linkedin_url, resume_url, profile_image_url
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
        RETURNING *`,
        [name, title, tagline, bio, location, email, phone, github_url, leetcode_url, linkedin_url, resume_url, profile_image_url]
      );
    } else {
      // Update existing profile
      result = await query(
        `UPDATE profile SET 
          name = $1, title = $2, tagline = $3, bio = $4, location = $5,
          email = $6, phone = $7, github_url = $8, leetcode_url = $9,
          linkedin_url = $10, resume_url = $11, profile_image_url = $12,
          updated_at = NOW()
        WHERE id = $13
        RETURNING *`,
        [name, title, tagline, bio, location, email, phone, github_url, leetcode_url, linkedin_url, resume_url, profile_image_url, existingProfile.rows[0].id]
      );
    }

    res.json({ 
      message: 'Profile updated successfully',
      profile: result.rows[0] 
    });
  } catch (error) {
    console.error('Update profile error:', error);
    res.status(500).json({ error: 'Failed to update profile' });
  }
});

// Get profile statistics (admin only)
router.get('/stats', authenticate, async (req, res) => {
  try {
    const stats = await Promise.all([
      query('SELECT COUNT(*) as count FROM skills'),
      query('SELECT COUNT(*) as count FROM experiences'),
      query('SELECT COUNT(*) as count FROM projects WHERE status = $1', ['published']),
      query('SELECT COUNT(*) as count FROM contact_submissions WHERE status = $1', ['new'])
    ]);

    res.json({
      stats: {
        skills: parseInt(stats[0].rows[0].count),
        experiences: parseInt(stats[1].rows[0].count),
        projects: parseInt(stats[2].rows[0].count),
        unreadMessages: parseInt(stats[3].rows[0].count)
      }
    });
  } catch (error) {
    console.error('Get profile stats error:', error);
    res.status(500).json({ error: 'Failed to get profile statistics' });
  }
});

export default router;