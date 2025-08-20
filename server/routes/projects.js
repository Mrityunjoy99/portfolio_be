import express from 'express';
import { body, validationResult } from 'express-validator';
import { v4 as uuid } from 'uuid';
import { authenticate } from '../middleware/auth.js';
import { 
  getAllProjects,
  getProjectById,
  getProjectBySlug,
  createProject,
  updateProject,
  updateProjectsOrder,
  deleteProject
} from '../config/portfolio-data.js';
import { invalidateCache } from '../config/portfolio-cache.js';

const router = express.Router();

// Get all projects with technologies (public endpoint)
router.get('/', async (req, res) => {
  try {
    const { status, featured } = req.query;
    
    // Always get all projects with technologies and images
    let projects = await getAllProjects();
    
    // Filter by status (default to published for public access)
    const targetStatus = status || 'published';
    projects = projects.filter(project => project.status === targetStatus);

    // Filter by featured if specified
    if (featured !== undefined) {
      const isFeatured = featured === 'true';
      projects = projects.filter(project => project.is_featured === isFeatured);
    }

    res.json({ projects });
  } catch (error) {
    console.error('Get projects error:', error);
    res.status(500).json({ error: 'Failed to get projects' });
  }
});

// Bulk update project order (admin only) - Must come before /:identifier route
router.put('/order/bulk', [
  authenticate,
  body('projects').isArray().withMessage('Projects must be an array'),
  body('projects.*.id').notEmpty().withMessage('Project ID is required'),
  body('projects.*.sort_order').isInt({ min: 0 }).withMessage('Sort order must be a non-negative integer')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ 
        error: 'Validation failed', 
        details: errors.array() 
      });
    }

    const { projects } = req.body;

    // Atomically update all project sort orders in single transaction
    await updateProjectsOrder(projects);

    // Invalidate cache after bulk order update
    await invalidateCache();

    res.json({ message: 'Project order updated successfully' });
  } catch (error) {
    console.error('Bulk update project order error:', error);
    res.status(500).json({ error: 'Failed to update project order' });
  }
});

// Get project by ID or slug with technologies (public endpoint)
router.get('/:identifier', async (req, res) => {
  try {
    const { identifier } = req.params;
    
    // Check if identifier is UUID or slug
    const isUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(identifier);
    
    let project;
    if (isUUID) {
      project = await getProjectById(identifier);
    } else {
      project = await getProjectBySlug(identifier);
    }

    if (!project || project.status !== 'published') {
      return res.status(404).json({ error: 'Project not found' });
    }

    res.json({ project });
  } catch (error) {
    console.error('Get project error:', error);
    res.status(500).json({ error: 'Failed to get project' });
  }
});

// Create new project (admin only)
router.post('/', [
  authenticate,
  body('title').trim().notEmpty().withMessage('Project title is required'),
  body('slug').trim().notEmpty().withMessage('Project slug is required'),
  body('short_description').optional().trim(),
  body('full_description').optional().trim(),
  body('featured_image_url').optional().custom((value) => {
    if (!value || value === null || value === '') return true;
    try {
      new URL(value);
      return true;
    } catch {
      throw new Error('Featured image URL must be valid');
    }
  }),
  body('demo_url').optional().custom((value) => {
    if (!value || value === null || value === '') return true;
    try {
      new URL(value);
      return true;
    } catch {
      throw new Error('Demo URL must be valid');
    }
  }),
  body('github_url').optional().custom((value) => {
    if (!value || value === null || value === '') return true;
    try {
      new URL(value);
      return true;
    } catch {
      throw new Error('GitHub URL must be valid');
    }
  }),
  body('publication_url').optional().custom((value) => {
    if (!value || value === null || value === '') return true;
    try {
      new URL(value);
      return true;
    } catch {
      throw new Error('Publication URL must be valid');
    }
  }),
  body('status').optional().isIn(['draft', 'published', 'archived']).withMessage('Status must be draft, published, or archived'),
  body('is_featured').optional().isBoolean().withMessage('is_featured must be a boolean'),
  body('sort_order').optional().isInt({ min: 0 }).withMessage('Sort order must be a non-negative integer'),
  body('technologies').optional().isArray().withMessage('Technologies must be an array'),
  body('images').optional().isArray().withMessage('Images must be an array'),
  body('images.*.image_url').isURL().withMessage('Image URL must be valid'),
  body('images.*.alt_text').optional().trim(),
  body('images.*.caption').optional().trim(),
  body('images.*.sort_order').optional().isInt({ min: 0 }).withMessage('Image sort order must be a non-negative integer')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ 
        error: 'Validation failed', 
        details: errors.array() 
      });
    }

    // Check if slug already exists
    const existingProject = await getProjectBySlug(req.body.slug);
    if (existingProject) {
      return res.status(400).json({ error: 'Project with this slug already exists' });
    }

    const projectData = {
      id: uuid(),
      title: req.body.title,
      slug: req.body.slug,
      short_description: req.body.short_description,
      full_description: req.body.full_description,
      featured_image_url: req.body.featured_image_url,
      demo_url: req.body.demo_url,
      github_url: req.body.github_url,
      publication_url: req.body.publication_url,
      status: req.body.status || 'published',
      is_featured: req.body.is_featured || false,
      sort_order: req.body.sort_order || 0,
      technologies: req.body.technologies || [],
      images: req.body.images || []
    };

    const result = await createProject(projectData);

    // Invalidate cache after project creation
    await invalidateCache();

    res.status(201).json({ 
      message: 'Project created successfully',
      project: result 
    });
  } catch (error) {
    console.error('Create project error:', error);
    if (error.message === 'Project with this slug already exists') {
      res.status(400).json({ error: error.message });
    } else {
      res.status(500).json({ error: 'Failed to create project' });
    }
  }
});

// Partially update project (admin only) - PATCH endpoint for partial updates
router.patch('/:id', [
  authenticate,
  body('title').optional().trim().notEmpty().withMessage('Project title cannot be empty'),
  body('slug').optional().trim().notEmpty().withMessage('Project slug cannot be empty'),
  body('short_description').optional().trim(),
  body('full_description').optional().trim(),
  body('featured_image_url').optional().custom((value) => {
    if (!value || value === null || value === '') return true;
    try {
      new URL(value);
      return true;
    } catch {
      throw new Error('Featured image URL must be valid');
    }
  }),
  body('demo_url').optional().custom((value) => {
    if (!value || value === null || value === '') return true;
    try {
      new URL(value);
      return true;
    } catch {
      throw new Error('Demo URL must be valid');
    }
  }),
  body('github_url').optional().custom((value) => {
    if (!value || value === null || value === '') return true;
    try {
      new URL(value);
      return true;
    } catch {
      throw new Error('GitHub URL must be valid');
    }
  }),
  body('publication_url').optional().custom((value) => {
    if (!value || value === null || value === '') return true;
    try {
      new URL(value);
      return true;
    } catch {
      throw new Error('Publication URL must be valid');
    }
  }),
  body('status').optional().isIn(['draft', 'published', 'archived']).withMessage('Status must be draft, published, or archived'),
  body('is_featured').optional().isBoolean().withMessage('is_featured must be a boolean'),
  body('sort_order').optional().isInt({ min: 0 }).withMessage('Sort order must be a non-negative integer'),
  body('technologies').optional().isArray().withMessage('Technologies must be an array'),
  body('images').optional().isArray().withMessage('Images must be an array'),
  body('images.*.image_url').isURL().withMessage('Image URL must be valid'),
  body('images.*.alt_text').optional().trim(),
  body('images.*.caption').optional().trim(),
  body('images.*.sort_order').optional().isInt({ min: 0 }).withMessage('Image sort order must be a non-negative integer')
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
      // Check if slug already exists for other projects (only if slug is being updated)
      if (req.body.slug) {
        const existingProject = await getProjectBySlug(req.body.slug);
        if (existingProject && existingProject.id !== id) {
          return res.status(400).json({ error: 'Project with this slug already exists' });
        }
      }

      const result = await updateProject(id, req.body);

      // Invalidate cache after project update
      await invalidateCache();

      res.json({ 
        message: 'Project updated successfully',
        project: result 
      });
    } catch (error) {
      if (error.message === 'Project not found') {
        return res.status(404).json({ error: 'Project not found' });
      }
      throw error;
    }
  } catch (error) {
    console.error('Patch project error:', error);
    if (error.message === 'Project not found') {
      res.status(404).json({ error: 'Project not found' });
    } else if (error.message === 'Project with this slug already exists') {
      res.status(400).json({ error: error.message });
    } else {
      res.status(500).json({ error: 'Failed to update project' });
    }
  }
});

// Update project (admin only) - PUT endpoint for full updates
router.put('/:id', [
  authenticate,
  body('title').optional().trim().notEmpty().withMessage('Project title cannot be empty'),
  body('slug').optional().trim().notEmpty().withMessage('Project slug cannot be empty'),
  body('short_description').optional().trim(),
  body('full_description').optional().trim(),
  body('featured_image_url').optional().custom((value) => {
    if (!value || value === null || value === '') return true;
    try {
      new URL(value);
      return true;
    } catch {
      throw new Error('Featured image URL must be valid');
    }
  }),
  body('demo_url').optional().custom((value) => {
    if (!value || value === null || value === '') return true;
    try {
      new URL(value);
      return true;
    } catch {
      throw new Error('Demo URL must be valid');
    }
  }),
  body('github_url').optional().custom((value) => {
    if (!value || value === null || value === '') return true;
    try {
      new URL(value);
      return true;
    } catch {
      throw new Error('GitHub URL must be valid');
    }
  }),
  body('publication_url').optional().custom((value) => {
    if (!value || value === null || value === '') return true;
    try {
      new URL(value);
      return true;
    } catch {
      throw new Error('Publication URL must be valid');
    }
  }),
  body('status').optional().isIn(['draft', 'published', 'archived']).withMessage('Status must be draft, published, or archived'),
  body('is_featured').optional().isBoolean().withMessage('is_featured must be a boolean'),
  body('sort_order').optional().isInt({ min: 0 }).withMessage('Sort order must be a non-negative integer'),
  body('technologies').optional().isArray().withMessage('Technologies must be an array'),
  body('images').optional().isArray().withMessage('Images must be an array'),
  body('images.*.image_url').isURL().withMessage('Image URL must be valid'),
  body('images.*.alt_text').optional().trim(),
  body('images.*.caption').optional().trim(),
  body('images.*.sort_order').optional().isInt({ min: 0 }).withMessage('Image sort order must be a non-negative integer')
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
      // Check if slug already exists for other projects
      if (req.body.slug) {
        const existingProject = await getProjectBySlug(req.body.slug);
        if (existingProject && existingProject.id !== id) {
          return res.status(400).json({ error: 'Project with this slug already exists' });
        }
      }

      const result = await updateProject(id, req.body);

      // Invalidate cache after project update
      await invalidateCache();

      res.json({ 
        message: 'Project updated successfully',
        project: result 
      });
    } catch (error) {
      if (error.message === 'Project not found') {
        return res.status(404).json({ error: 'Project not found' });
      }
      throw error;
    }
  } catch (error) {
    console.error('Update project error:', error);
    if (error.message === 'Project not found') {
      res.status(404).json({ error: 'Project not found' });
    } else if (error.message === 'Project with this slug already exists') {
      res.status(400).json({ error: error.message });
    } else {
      res.status(500).json({ error: 'Failed to update project' });
    }
  }
});

// Delete project (admin only)
router.delete('/:id', authenticate, async (req, res) => {
  try {
    const { id } = req.params;

    const result = await deleteProject(id);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Project not found' });
    }

    // Invalidate cache after project deletion
    await invalidateCache();

    res.json({ 
      message: 'Project deleted successfully',
      project: result.rows[0].value
    });
  } catch (error) {
    console.error('Delete project error:', error);
    res.status(500).json({ error: 'Failed to delete project' });
  }
});

export default router;