import express from 'express';
import { body, validationResult } from 'express-validator';
import { query, transaction } from '../config/database.js';
import { authenticate } from '../middleware/auth.js';

const router = express.Router();

// Get all projects with technologies (public endpoint)
router.get('/', async (req, res) => {
  try {
    const { status, featured } = req.query;
    
    let queryText = 'SELECT * FROM projects';
    let queryParams = [];
    let conditions = [];

    // Default to published for public access
    if (!status) {
      conditions.push(`status = $${queryParams.length + 1}`);
      queryParams.push('published');
    } else {
      conditions.push(`status = $${queryParams.length + 1}`);
      queryParams.push(status);
    }

    if (featured !== undefined) {
      conditions.push(`is_featured = $${queryParams.length + 1}`);
      queryParams.push(featured === 'true');
    }

    if (conditions.length > 0) {
      queryText += ' WHERE ' + conditions.join(' AND ');
    }

    queryText += ' ORDER BY sort_order ASC, created_at DESC';

    const projectsResult = await query(queryText, queryParams);

    // Get technologies for each project
    const projects = await Promise.all(
      projectsResult.rows.map(async (project) => {
        const technologiesResult = await query(
          'SELECT technology FROM project_technologies WHERE project_id = $1',
          [project.id]
        );
        
        const imagesResult = await query(
          'SELECT * FROM project_images WHERE project_id = $1 ORDER BY sort_order ASC',
          [project.id]
        );
        
        return {
          ...project,
          technologies: technologiesResult.rows.map(row => row.technology),
          images: imagesResult.rows
        };
      })
    );

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

    // Update each project's sort order
    const updatePromises = projects.map(project => 
      query(
        'UPDATE projects SET sort_order = $1 WHERE id = $2',
        [project.sort_order, project.id]
      )
    );

    await Promise.all(updatePromises);

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
    
    const projectResult = await query(
      `SELECT * FROM projects WHERE ${isUUID ? 'id' : 'slug'} = $1 AND status = 'published'`,
      [identifier]
    );

    if (projectResult.rows.length === 0) {
      return res.status(404).json({ error: 'Project not found' });
    }

    const project = projectResult.rows[0];

    const technologiesResult = await query(
      'SELECT technology FROM project_technologies WHERE project_id = $1',
      [project.id]
    );

    const imagesResult = await query(
      'SELECT * FROM project_images WHERE project_id = $1 ORDER BY sort_order ASC',
      [project.id]
    );

    const projectWithDetails = {
      ...project,
      technologies: technologiesResult.rows.map(row => row.technology),
      images: imagesResult.rows
    };

    res.json({ project: projectWithDetails });
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

    const {
      title,
      slug,
      short_description,
      full_description,
      featured_image_url,
      demo_url,
      github_url,
      publication_url,
      status = 'published',
      is_featured = false,
      sort_order = 0,
      technologies = [],
      images = []
    } = req.body;

    const result = await transaction(async (client) => {
      // Check if slug already exists
      const existingProject = await client.query(
        'SELECT id FROM projects WHERE slug = $1',
        [slug]
      );

      if (existingProject.rows.length > 0) {
        throw new Error('Project with this slug already exists');
      }

      // Create project
      const projectResult = await client.query(
        `INSERT INTO projects (title, slug, short_description, full_description, featured_image_url, demo_url, github_url, publication_url, status, is_featured, sort_order)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
         RETURNING *`,
        [title, slug, short_description, full_description, featured_image_url, demo_url, github_url, publication_url, status, is_featured, sort_order]
      );

      const project = projectResult.rows[0];

      // Create technologies
      const createdTechnologies = [];
      for (const technology of technologies) {
        await client.query(
          'INSERT INTO project_technologies (project_id, technology) VALUES ($1, $2)',
          [project.id, technology]
        );
        createdTechnologies.push(technology);
      }

      // Create images
      const createdImages = [];
      for (let i = 0; i < images.length; i++) {
        const image = images[i];
        const imageResult = await client.query(
          `INSERT INTO project_images (project_id, image_url, alt_text, caption, sort_order)
           VALUES ($1, $2, $3, $4, $5)
           RETURNING *`,
          [project.id, image.image_url, image.alt_text, image.caption, image.sort_order || i]
        );
        createdImages.push(imageResult.rows[0]);
      }

      return {
        ...project,
        technologies: createdTechnologies,
        images: createdImages
      };
    });

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
    const updateData = req.body;

    const result = await transaction(async (client) => {
      // First, get the current project
      const currentProjectResult = await client.query(
        'SELECT * FROM projects WHERE id = $1',
        [id]
      );

      if (currentProjectResult.rows.length === 0) {
        throw new Error('Project not found');
      }

      const currentProject = currentProjectResult.rows[0];

      // Check if slug already exists for other projects (only if slug is being updated)
      if (updateData.slug && updateData.slug !== currentProject.slug) {
        const existingProject = await client.query(
          'SELECT id FROM projects WHERE slug = $1 AND id != $2',
          [updateData.slug, id]
        );

        if (existingProject.rows.length > 0) {
          throw new Error('Project with this slug already exists');
        }
      }

      // Build dynamic update query only for provided fields
      const updateFields = [];
      const updateValues = [];
      let paramCount = 1;

      // Only update fields that are provided in the request
      Object.keys(updateData).forEach(key => {
        if (key !== 'technologies' && key !== 'images' && updateData[key] !== undefined) {
          updateFields.push(`${key} = $${paramCount}`);
          updateValues.push(updateData[key]);
          paramCount++;
        }
      });

      // Always update the updated_at field
      updateFields.push(`updated_at = NOW()`);

      // Update project if there are fields to update
      let project = currentProject;
      if (updateFields.length > 1) { // More than just updated_at
        const updateQuery = `UPDATE projects SET ${updateFields.join(', ')} WHERE id = $${paramCount} RETURNING *`;
        updateValues.push(id);

        const projectResult = await client.query(updateQuery, updateValues);
        project = projectResult.rows[0];
      }

      // Handle technologies update if provided
      let technologies = [];
      if (updateData.technologies !== undefined) {
        // Delete existing technologies
        await client.query('DELETE FROM project_technologies WHERE project_id = $1', [id]);
        
        // Create new technologies
        for (const technology of updateData.technologies) {
          await client.query(
            'INSERT INTO project_technologies (project_id, technology) VALUES ($1, $2)',
            [project.id, technology]
          );
          technologies.push(technology);
        }
      } else {
        // Get existing technologies
        const technologiesResult = await client.query(
          'SELECT technology FROM project_technologies WHERE project_id = $1',
          [project.id]
        );
        technologies = technologiesResult.rows.map(row => row.technology);
      }

      // Handle images update if provided
      let images = [];
      if (updateData.images !== undefined) {
        // Delete existing images
        await client.query('DELETE FROM project_images WHERE project_id = $1', [id]);
        
        // Create new images
        for (let i = 0; i < updateData.images.length; i++) {
          const image = updateData.images[i];
          const imageResult = await client.query(
            `INSERT INTO project_images (project_id, image_url, alt_text, caption, sort_order)
             VALUES ($1, $2, $3, $4, $5)
             RETURNING *`,
            [project.id, image.image_url, image.alt_text, image.caption, image.sort_order || i]
          );
          images.push(imageResult.rows[0]);
        }
      } else {
        // Get existing images
        const imagesResult = await client.query(
          'SELECT * FROM project_images WHERE project_id = $1 ORDER BY sort_order ASC',
          [project.id]
        );
        images = imagesResult.rows;
      }

      return {
        ...project,
        technologies: technologies,
        images: images
      };
    });

    res.json({ 
      message: 'Project updated successfully',
      project: result 
    });
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
    const {
      title,
      slug,
      short_description,
      full_description,
      featured_image_url,
      demo_url,
      github_url,
      publication_url,
      status,
      is_featured,
      sort_order,
      technologies = [],
      images = []
    } = req.body;

    const result = await transaction(async (client) => {
      // Check if slug already exists for other projects
      const existingProject = await client.query(
        'SELECT id FROM projects WHERE slug = $1 AND id != $2',
        [slug, id]
      );

      if (existingProject.rows.length > 0) {
        throw new Error('Project with this slug already exists');
      }

      // Update project
      const projectResult = await client.query(
        `UPDATE projects SET 
          title = $1, slug = $2, short_description = $3, full_description = $4,
          featured_image_url = $5, demo_url = $6, github_url = $7, publication_url = $8,
          status = $9, is_featured = $10, sort_order = $11, updated_at = NOW()
         WHERE id = $12
         RETURNING *`,
        [title, slug, short_description, full_description, featured_image_url, demo_url, github_url, publication_url, status, is_featured, sort_order, id]
      );

      if (projectResult.rows.length === 0) {
        throw new Error('Project not found');
      }

      const project = projectResult.rows[0];

      // Delete existing technologies and images
      await client.query('DELETE FROM project_technologies WHERE project_id = $1', [id]);
      await client.query('DELETE FROM project_images WHERE project_id = $1', [id]);

      // Create new technologies
      const createdTechnologies = [];
      for (const technology of technologies) {
        await client.query(
          'INSERT INTO project_technologies (project_id, technology) VALUES ($1, $2)',
          [project.id, technology]
        );
        createdTechnologies.push(technology);
      }

      // Create new images
      const createdImages = [];
      for (let i = 0; i < images.length; i++) {
        const image = images[i];
        const imageResult = await client.query(
          `INSERT INTO project_images (project_id, image_url, alt_text, caption, sort_order)
           VALUES ($1, $2, $3, $4, $5)
           RETURNING *`,
          [project.id, image.image_url, image.alt_text, image.caption, image.sort_order || i]
        );
        createdImages.push(imageResult.rows[0]);
      }

      return {
        ...project,
        technologies: createdTechnologies,
        images: createdImages
      };
    });

    res.json({ 
      message: 'Project updated successfully',
      project: result 
    });
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

    const result = await query(
      'DELETE FROM projects WHERE id = $1 RETURNING *',
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Project not found' });
    }

    res.json({ 
      message: 'Project deleted successfully',
      project: result.rows[0] 
    });
  } catch (error) {
    console.error('Delete project error:', error);
    res.status(500).json({ error: 'Failed to delete project' });
  }
});

export default router;