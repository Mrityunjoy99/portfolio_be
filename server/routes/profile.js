import express from 'express';
import { body, validationResult } from 'express-validator';
import { v4 as uuid } from 'uuid';
import { authenticate, optionalAuth } from '../middleware/auth.js';
import { 
  getProfile, 
  setProfile,
  getDashboardStats 
} from '../config/portfolio-data.js';

const router = express.Router();

// Get profile data (public endpoint)
router.get('/', async (req, res) => {
  try {
    const profile = await getProfile();

    if (!profile) {
      return res.status(404).json({ error: 'Profile not found' });
    }

    res.json({ profile });
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
    // Accept relative paths starting with /uploads/ or full URLs
    if (value.startsWith('/uploads/')) return true;
    try {
      new URL(value);
      return true;
    } catch {
      throw new Error('Resume URL must be valid URL or relative path');
    }
  }),
  body('profile_image_url').optional().custom((value) => {
    if (!value || value === null || value === '') return true;
    // Accept relative paths starting with /uploads/ or full URLs
    if (value.startsWith('/uploads/')) return true;
    try {
      new URL(value);
      return true;
    } catch {
      throw new Error('Profile image URL must be valid URL or relative path');
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

    const profileData = {
      id: uuid(), // Generate new ID if creating, will be preserved if updating
      name: req.body.name,
      title: req.body.title,
      tagline: req.body.tagline,
      bio: req.body.bio,
      location: req.body.location,
      email: req.body.email,
      phone: req.body.phone,
      github_url: req.body.github_url,
      leetcode_url: req.body.leetcode_url,
      linkedin_url: req.body.linkedin_url,
      resume_url: req.body.resume_url,
      profile_image_url: req.body.profile_image_url
    };

    // Check if profile exists
    const existingProfile = await getProfile();

    if (existingProfile) {
      // Preserve existing ID and created_at
      profileData.id = existingProfile.id;
      profileData.created_at = existingProfile.created_at;
    } else {
      // New profile
      profileData.created_at = new Date().toISOString();
    }

    await setProfile(profileData);

    res.json({ 
      message: 'Profile updated successfully',
      profile: profileData
    });
  } catch (error) {
    console.error('Update profile error:', error);
    res.status(500).json({ error: 'Failed to update profile' });
  }
});

// Get profile statistics (admin only)
router.get('/stats', authenticate, async (req, res) => {
  try {
    const stats = await getDashboardStats();

    res.json({ stats });
  } catch (error) {
    console.error('Get profile stats error:', error);
    res.status(500).json({ error: 'Failed to get profile statistics' });
  }
});

export default router;