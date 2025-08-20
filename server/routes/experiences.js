import express from 'express';
import { body, validationResult } from 'express-validator';
import { v4 as uuid } from 'uuid';
import { authenticate } from '../middleware/auth.js';
import { 
  getAllExperiences,
  getExperienceById,
  createExperience,
  updateExperienceWithAchievements,
  updateExperiencesOrder,
  deleteExperience,
  createAchievement
} from '../config/portfolio-data.js';
import { invalidateCache } from '../config/portfolio-cache.js';

const router = express.Router();

// Get all experiences with achievements (public endpoint)
router.get('/', async (req, res) => {
  try {
    const experiences = await getAllExperiences();
    res.json({ experiences });
  } catch (error) {
    console.error('Get experiences error:', error);
    res.status(500).json({ error: 'Failed to get experiences' });
  }
});

// Bulk update experience order (admin only) - Must come before /:id route
router.put('/order/bulk', [
  authenticate,
  body('experiences').isArray().withMessage('Experiences must be an array'),
  body('experiences.*.id').notEmpty().withMessage('Experience ID is required'),
  body('experiences.*.sort_order').isInt({ min: 0 }).withMessage('Sort order must be a non-negative integer')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ 
        error: 'Validation failed', 
        details: errors.array() 
      });
    }

    const { experiences } = req.body;

    // Atomically update all experience sort orders in single transaction
    await updateExperiencesOrder(experiences);

    // Invalidate entire cache after bulk order update
    await invalidateCache();

    res.json({ message: 'Experience order updated successfully' });
  } catch (error) {
    console.error('Bulk update experience order error:', error);
    res.status(500).json({ error: 'Failed to update experience order' });
  }
});

// Get experience by ID with achievements (public endpoint)
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    const experience = await getExperienceById(id);

    if (!experience) {
      return res.status(404).json({ error: 'Experience not found' });
    }

    // Get achievements for this experience (they're already included in getAllExperiences, but not in getExperienceById)
    const allExperiences = await getAllExperiences();
    const fullExperience = allExperiences.find(exp => exp.id === id);

    res.json({ experience: fullExperience || experience });
  } catch (error) {
    console.error('Get experience error:', error);
    res.status(500).json({ error: 'Failed to get experience' });
  }
});

// Create new experience (admin only)
router.post('/', [
  authenticate,
  body('company').trim().notEmpty().withMessage('Company name is required'),
  body('position').trim().notEmpty().withMessage('Position is required'),
  body('start_date').isISO8601().withMessage('Valid start date is required'),
  body('end_date').optional({ nullable: true, checkFalsy: true }).isISO8601().withMessage('End date must be valid'),
  body('location').optional().trim(),
  body('company_logo_url').optional({ nullable: true, checkFalsy: true }).isURL().withMessage('Company logo URL must be valid'),
  body('description').optional().trim(),
  body('sort_order').optional().isInt({ min: 0 }).withMessage('Sort order must be a non-negative integer'),
  body('achievements').optional().isArray().withMessage('Achievements must be an array'),
  body('achievements.*.description').trim().notEmpty().withMessage('Achievement description is required'),
  body('achievements.*.icon_name').optional().trim(),
  body('achievements.*.metrics').optional().trim(),
  body('achievements.*.sort_order').optional().isInt({ min: 0 }).withMessage('Achievement sort order must be a non-negative integer')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ 
        error: 'Validation failed', 
        details: errors.array() 
      });
    }

    const experienceId = uuid();
    
    const experienceData = {
      id: experienceId,
      company: req.body.company,
      position: req.body.position,
      start_date: req.body.start_date,
      end_date: req.body.end_date,
      location: req.body.location,
      company_logo_url: req.body.company_logo_url,
      description: req.body.description,
      sort_order: req.body.sort_order || 0
    };

    // Create experience
    await createExperience(experienceData);

    // Create achievements
    const createdAchievements = [];
    const achievements = req.body.achievements || [];
    
    for (let i = 0; i < achievements.length; i++) {
      const achievementData = {
        id: uuid(),
        experience_id: experienceId,
        description: achievements[i].description,
        icon_name: achievements[i].icon_name,
        metrics: achievements[i].metrics,
        sort_order: achievements[i].sort_order || i
      };
      
      await createAchievement(achievementData);
      createdAchievements.push(achievementData);
    }

    const result = {
      ...experienceData,
      achievements: createdAchievements
    };

    // Invalidate cache after experience creation
    await invalidateCache();

    res.status(201).json({ 
      message: 'Experience created successfully',
      experience: result 
    });
  } catch (error) {
    console.error('Create experience error:', error);
    res.status(500).json({ error: 'Failed to create experience' });
  }
});

// Update experience (admin only)
router.put('/:id', [
  authenticate,
  body('company').trim().notEmpty().withMessage('Company name is required'),
  body('position').trim().notEmpty().withMessage('Position is required'),
  body('start_date').isISO8601().withMessage('Valid start date is required'),
  body('end_date').optional({ nullable: true, checkFalsy: true }).isISO8601().withMessage('End date must be valid'),
  body('location').optional().trim(),
  body('company_logo_url').optional({ nullable: true, checkFalsy: true }).isURL().withMessage('Company logo URL must be valid'),
  body('description').optional().trim(),
  body('sort_order').optional().isInt({ min: 0 }).withMessage('Sort order must be a non-negative integer'),
  body('achievements').optional().isArray().withMessage('Achievements must be an array'),
  body('achievements.*.id').optional().trim(),
  body('achievements.*.description').trim().notEmpty().withMessage('Achievement description is required'),
  body('achievements.*.icon_name').optional().trim(),
  body('achievements.*.metrics').optional().trim(),
  body('achievements.*.sort_order').optional().isInt({ min: 0 }).withMessage('Achievement sort order must be a non-negative integer')
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
    
    try {
      // Update experience and achievements atomically
      const experienceData = {
        company: req.body.company,
        position: req.body.position,
        start_date: req.body.start_date,
        end_date: req.body.end_date,
        location: req.body.location,
        company_logo_url: req.body.company_logo_url,
        description: req.body.description,
        sort_order: req.body.sort_order
      };

      const achievements = req.body.achievements || [];
      
      // Single atomic operation that prevents race conditions
      const result = await updateExperienceWithAchievements(id, experienceData, achievements);

      // Invalidate cache after experience update
      await invalidateCache();

      res.json({ 
        message: 'Experience updated successfully',
        experience: result 
      });
    } catch (error) {
      if (error.message === 'Experience not found') {
        return res.status(404).json({ error: 'Experience not found' });
      }
      throw error;
    }
  } catch (error) {
    console.error('Update experience error:', error);
    if (error.message === 'Experience not found') {
      res.status(404).json({ error: 'Experience not found' });
    } else {
      res.status(500).json({ error: 'Failed to update experience' });
    }
  }
});

// Delete experience (admin only)
router.delete('/:id', authenticate, async (req, res) => {
  try {
    const { id } = req.params;

    const result = await deleteExperience(id);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Experience not found' });
    }

    // Invalidate cache after experience deletion
    await invalidateCache();

    res.json({ 
      message: 'Experience deleted successfully',
      experience: result.rows[0].value
    });
  } catch (error) {
    console.error('Delete experience error:', error);
    res.status(500).json({ error: 'Failed to delete experience' });
  }
});

export default router;