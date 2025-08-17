import express from 'express';
import { body, validationResult } from 'express-validator';
import { query, transaction } from '../config/database.js';
import { authenticate } from '../middleware/auth.js';

const router = express.Router();

// Get all experiences with achievements (public endpoint)
router.get('/', async (req, res) => {
  try {
    // Get experiences
    const experiencesResult = await query(
      'SELECT * FROM experiences ORDER BY sort_order ASC, start_date DESC'
    );

    // Get achievements for each experience
    const experiences = await Promise.all(
      experiencesResult.rows.map(async (experience) => {
        const achievementsResult = await query(
          'SELECT * FROM achievements WHERE experience_id = $1 ORDER BY sort_order ASC',
          [experience.id]
        );
        
        return {
          ...experience,
          achievements: achievementsResult.rows
        };
      })
    );

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

    // Update each experience's sort order
    const updatePromises = experiences.map(experience => 
      query(
        'UPDATE experiences SET sort_order = $1 WHERE id = $2',
        [experience.sort_order, experience.id]
      )
    );

    await Promise.all(updatePromises);

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
    
    const experienceResult = await query(
      'SELECT * FROM experiences WHERE id = $1',
      [id]
    );

    if (experienceResult.rows.length === 0) {
      return res.status(404).json({ error: 'Experience not found' });
    }

    const achievementsResult = await query(
      'SELECT * FROM achievements WHERE experience_id = $1 ORDER BY sort_order ASC',
      [id]
    );

    const experience = {
      ...experienceResult.rows[0],
      achievements: achievementsResult.rows
    };

    res.json({ experience });
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

    const {
      company,
      position,
      start_date,
      end_date,
      location,
      company_logo_url,
      description,
      sort_order = 0,
      achievements = []
    } = req.body;

    const result = await transaction(async (client) => {
      // Create experience
      const experienceResult = await client.query(
        `INSERT INTO experiences (company, position, start_date, end_date, location, company_logo_url, description, sort_order)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         RETURNING *`,
        [company, position, start_date, end_date, location, company_logo_url, description, sort_order]
      );

      const experience = experienceResult.rows[0];

      // Create achievements
      const createdAchievements = [];
      for (let i = 0; i < achievements.length; i++) {
        const achievement = achievements[i];
        const achievementResult = await client.query(
          `INSERT INTO achievements (experience_id, description, icon_name, metrics, sort_order)
           VALUES ($1, $2, $3, $4, $5)
           RETURNING *`,
          [experience.id, achievement.description, achievement.icon_name, achievement.metrics, achievement.sort_order || i]
        );
        createdAchievements.push(achievementResult.rows[0]);
      }

      return {
        ...experience,
        achievements: createdAchievements
      };
    });

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
    const {
      company,
      position,
      start_date,
      end_date,
      location,
      company_logo_url,
      description,
      sort_order,
      achievements = []
    } = req.body;

    const result = await transaction(async (client) => {
      // Update experience
      const experienceResult = await client.query(
        `UPDATE experiences SET 
          company = $1, position = $2, start_date = $3, end_date = $4,
          location = $5, company_logo_url = $6, description = $7, sort_order = $8
         WHERE id = $9
         RETURNING *`,
        [company, position, start_date, end_date, location, company_logo_url, description, sort_order, id]
      );

      if (experienceResult.rows.length === 0) {
        throw new Error('Experience not found');
      }

      const experience = experienceResult.rows[0];

      // Delete existing achievements
      await client.query('DELETE FROM achievements WHERE experience_id = $1', [id]);

      // Create new achievements
      const createdAchievements = [];
      for (let i = 0; i < achievements.length; i++) {
        const achievement = achievements[i];
        const achievementResult = await client.query(
          `INSERT INTO achievements (experience_id, description, icon_name, metrics, sort_order)
           VALUES ($1, $2, $3, $4, $5)
           RETURNING *`,
          [experience.id, achievement.description, achievement.icon_name, achievement.metrics, achievement.sort_order || i]
        );
        createdAchievements.push(achievementResult.rows[0]);
      }

      return {
        ...experience,
        achievements: createdAchievements
      };
    });

    res.json({ 
      message: 'Experience updated successfully',
      experience: result 
    });
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

    const result = await query(
      'DELETE FROM experiences WHERE id = $1 RETURNING *',
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Experience not found' });
    }

    res.json({ 
      message: 'Experience deleted successfully',
      experience: result.rows[0] 
    });
  } catch (error) {
    console.error('Delete experience error:', error);
    res.status(500).json({ error: 'Failed to delete experience' });
  }
});

export default router;