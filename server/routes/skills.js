import express from 'express';
import { body, validationResult } from 'express-validator';
import { v4 as uuid } from 'uuid';
import { authenticate } from '../middleware/auth.js';
import { 
  getAllSkills, 
  getSkillsByCategory, 
  getFeaturedSkills,
  getSkillById,
  createSkill,
  updateSkill,
  deleteSkill,
  updateSkillsOrder
} from '../config/portfolio-data.js';

const router = express.Router();

// Get all skills (public endpoint)
router.get('/', async (req, res) => {
  try {
    const { category, featured } = req.query;
    
    let skills;
    if (category) {
      skills = await getSkillsByCategory(category);
    } else if (featured !== undefined) {
      skills = await getFeaturedSkills();
    } else {
      skills = await getAllSkills();
    }
    
    // Sort skills
    skills.sort((a, b) => {
      // First by proficiency (descending, nulls last)
      if (b.proficiency !== a.proficiency) {
        if (a.proficiency === null) return 1;
        if (b.proficiency === null) return -1;
        return b.proficiency - a.proficiency;
      }
      // Then by sort_order (ascending)
      if (a.sort_order !== b.sort_order) return a.sort_order - b.sort_order;
      // Finally by name (ascending)
      return a.name.localeCompare(b.name);
    });

    res.json({ skills });
  } catch (error) {
    console.error('Get skills error:', error);
    res.status(500).json({ error: 'Failed to get skills' });
  }
});

// Get skill categories (public endpoint) - Must come before /:id route
router.get('/categories/list', async (req, res) => {
  try {
    const skills = await getAllSkills();
    const categories = [...new Set(skills.map(skill => skill.category))].sort();
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

    // Update skills order using the new data access layer
    await updateSkillsOrder(skills);

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

    // Update skills order using the new data access layer
    // Note: The proficiency validation would need to be done at the application level
    await updateSkillsOrder(skills);

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
    
    const skill = await getSkillById(id);

    if (!skill) {
      return res.status(404).json({ error: 'Skill not found' });
    }

    res.json({ skill });
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

    const skillData = {
      id: uuid(),
      name: req.body.name,
      category: req.body.category,
      proficiency: req.body.proficiency,
      icon_name: req.body.icon_name,
      years_experience: req.body.years_experience,
      is_featured: req.body.is_featured || false,
      sort_order: req.body.sort_order || 0
    };

    await createSkill(skillData);

    res.status(201).json({ 
      message: 'Skill created successfully',
      skill: skillData
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
    
    try {
      const updatedSkill = await updateSkill(id, req.body);

      res.json({ 
        message: 'Skill updated successfully',
        skill: updatedSkill.value
      });
    } catch (error) {
      if (error.message === 'Skill not found') {
        return res.status(404).json({ error: 'Skill not found' });
      }
      throw error;
    }
  } catch (error) {
    console.error('Update skill error:', error);
    res.status(500).json({ error: 'Failed to update skill' });
  }
});

// Delete skill (admin only)
router.delete('/:id', authenticate, async (req, res) => {
  try {
    const { id } = req.params;

    const result = await deleteSkill(id);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Skill not found' });
    }

    res.json({ 
      message: 'Skill deleted successfully',
      skill: result.rows[0].value
    });
  } catch (error) {
    console.error('Delete skill error:', error);
    res.status(500).json({ error: 'Failed to delete skill' });
  }
});

export default router;