import express from 'express';
import { body, validationResult } from 'express-validator';
import { query } from '../config/database.js';
import { authenticate } from '../middleware/auth.js';

const router = express.Router();

// Get all skills (public endpoint)
router.get('/', async (req, res) => {
  try {
    const { category, featured } = req.query;
    
    let queryText = 'SELECT * FROM skills';
    let queryParams = [];
    let conditions = [];

    if (category) {
      conditions.push(`category = $${queryParams.length + 1}`);
      queryParams.push(category);
    }

    if (featured !== undefined) {
      conditions.push(`is_featured = $${queryParams.length + 1}`);
      queryParams.push(featured === 'true');
    }

    if (conditions.length > 0) {
      queryText += ' WHERE ' + conditions.join(' AND ');
    }

    queryText += ' ORDER BY proficiency DESC NULLS LAST, sort_order ASC, name ASC';

    const result = await query(queryText, queryParams);

    res.json({ skills: result.rows });
  } catch (error) {
    console.error('Get skills error:', error);
    res.status(500).json({ error: 'Failed to get skills' });
  }
});

// Get skill categories (public endpoint) - Must come before /:id route
router.get('/categories/list', async (req, res) => {
  try {
    const result = await query(
      'SELECT DISTINCT category FROM skills ORDER BY category'
    );

    const categories = result.rows.map(row => row.category);
    res.json({ categories });
  } catch (error) {
    console.error('Get skill categories error:', error);
    res.status(500).json({ error: 'Failed to get skill categories' });
  }
});

// Bulk update skill order (admin only) - Must come before /:id route
router.put('/order/bulk', [
  authenticate,
  body('skills').isArray().withMessage('Skills must be an array'),
  body('skills.*.id').notEmpty().withMessage('Skill ID is required'),
  body('skills.*.sort_order').isInt({ min: 0 }).withMessage('Sort order must be a non-negative integer')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ 
        error: 'Validation failed', 
        details: errors.array() 
      });
    }

    const { skills } = req.body;

    // Update each skill's sort order
    const updatePromises = skills.map(skill => 
      query(
        'UPDATE skills SET sort_order = $1 WHERE id = $2',
        [skill.sort_order, skill.id]
      )
    );

    await Promise.all(updatePromises);

    res.json({ message: 'Skill order updated successfully' });
  } catch (error) {
    console.error('Bulk update skill order error:', error);
    res.status(500).json({ error: 'Failed to update skill order' });
  }
});

// Update skill order within proficiency level (admin only)
router.put('/order/proficiency', [
  authenticate,
  body('skills').isArray().withMessage('Skills must be an array'),
  body('skills.*.id').notEmpty().withMessage('Skill ID is required'),
  body('skills.*.sort_order').isInt({ min: 0 }).withMessage('Sort order must be a non-negative integer'),
  body('skills.*.proficiency').optional().isInt({ min: 1, max: 5 }).withMessage('Proficiency must be between 1 and 5')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ 
        error: 'Validation failed', 
        details: errors.array() 
      });
    }

    const { skills } = req.body;

    // Update each skill's sort order (proficiency level can only be changed individually)
    // This endpoint only allows rearranging within the same proficiency level
    const updatePromises = skills.map(skill => 
      query(
        'UPDATE skills SET sort_order = $1 WHERE id = $2 AND (proficiency = $3 OR $3 IS NULL)',
        [skill.sort_order, skill.id, skill.proficiency || null]
      )
    );

    await Promise.all(updatePromises);

    res.json({ message: 'Skill order within proficiency levels updated successfully' });
  } catch (error) {
    console.error('Update skill order within proficiency error:', error);
    res.status(500).json({ error: 'Failed to update skill order within proficiency levels' });
  }
});

// Get skill by ID (public endpoint)
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    const result = await query(
      'SELECT * FROM skills WHERE id = $1',
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Skill not found' });
    }

    res.json({ skill: result.rows[0] });
  } catch (error) {
    console.error('Get skill error:', error);
    res.status(500).json({ error: 'Failed to get skill' });
  }
});

// Create new skill (admin only)
router.post('/', [
  authenticate,
  body('name').trim().notEmpty().withMessage('Skill name is required'),
  body('category').trim().notEmpty().withMessage('Category is required'),
  body('proficiency').optional().isInt({ min: 1, max: 5 }).withMessage('Proficiency must be between 1 and 5'),
  body('icon_name').optional().trim(),
  body('years_experience').optional().isFloat({ min: 0 }).withMessage('Years of experience must be a positive number'),
  body('is_featured').optional().isBoolean().withMessage('is_featured must be a boolean'),
  body('sort_order').optional().isInt({ min: 0 }).withMessage('Sort order must be a non-negative integer')
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
      name,
      category,
      proficiency,
      icon_name,
      years_experience,
      is_featured = false,
      sort_order = 0
    } = req.body;

    const result = await query(
      `INSERT INTO skills (name, category, proficiency, icon_name, years_experience, is_featured, sort_order)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [name, category, proficiency, icon_name, years_experience, is_featured, sort_order]
    );

    res.status(201).json({ 
      message: 'Skill created successfully',
      skill: result.rows[0] 
    });
  } catch (error) {
    console.error('Create skill error:', error);
    res.status(500).json({ error: 'Failed to create skill' });
  }
});

// Update skill (admin only)
router.put('/:id', [
  authenticate,
  body('name').optional().trim().notEmpty().withMessage('Skill name cannot be empty'),
  body('category').optional().trim().notEmpty().withMessage('Category cannot be empty'),
  body('proficiency').optional().isInt({ min: 1, max: 5 }).withMessage('Proficiency must be between 1 and 5'),
  body('icon_name').optional().trim(),
  body('years_experience').optional().isFloat({ min: 0 }).withMessage('Years of experience must be a positive number'),
  body('is_featured').optional().isBoolean().withMessage('is_featured must be a boolean'),
  body('sort_order').optional().isInt({ min: 0 }).withMessage('Sort order must be a non-negative integer')
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
    const updateData = req.body;

    // First get the current skill data
    const currentResult = await query('SELECT * FROM skills WHERE id = $1', [id]);
    
    if (currentResult.rows.length === 0) {
      return res.status(404).json({ error: 'Skill not found' });
    }

    const currentSkill = currentResult.rows[0];
    
    // Merge current data with updates
    const {
      name = currentSkill.name,
      category = currentSkill.category,
      proficiency = currentSkill.proficiency,
      icon_name = currentSkill.icon_name,
      years_experience = currentSkill.years_experience,
      is_featured = currentSkill.is_featured,
      sort_order = currentSkill.sort_order
    } = updateData;

    const result = await query(
      `UPDATE skills SET 
        name = $1, category = $2, proficiency = $3, icon_name = $4,
        years_experience = $5, is_featured = $6, sort_order = $7
       WHERE id = $8
       RETURNING *`,
      [name, category, proficiency, icon_name, years_experience, is_featured, sort_order, id]
    );

    res.json({ 
      message: 'Skill updated successfully',
      skill: result.rows[0] 
    });
  } catch (error) {
    console.error('Update skill error:', error);
    res.status(500).json({ error: 'Failed to update skill' });
  }
});

// Delete skill (admin only)
router.delete('/:id', authenticate, async (req, res) => {
  try {
    const { id } = req.params;

    const result = await query(
      'DELETE FROM skills WHERE id = $1 RETURNING *',
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Skill not found' });
    }

    res.json({ 
      message: 'Skill deleted successfully',
      skill: result.rows[0] 
    });
  } catch (error) {
    console.error('Delete skill error:', error);
    res.status(500).json({ error: 'Failed to delete skill' });
  }
});

export default router;