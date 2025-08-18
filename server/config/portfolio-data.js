/**
 * Portfolio Data Access Layer
 * 
 * This module provides all the data access functions for the key-value
 * portfolio_data table. It abstracts the complexity of working with
 * JSON documents and provides a clean API for route handlers.
 */

import { query, transaction } from './database.js';
import { v4 as uuid } from 'uuid';

// ============================================================================
// Core Helper Functions
// ============================================================================

/**
 * Get single record by key
 */
export const getPortfolioItem = async (key) => {
  const result = await query(
    'SELECT * FROM portfolio_data WHERE key = $1 AND is_active = TRUE',
    [key]
  );
  return result.rows[0]?.value || null;
};

/**
 * Get all records by type (MUCH MORE EFFICIENT than prefix search)
 */
export const getPortfolioItemsByType = async (type) => {
  const result = await query(
    'SELECT key, value FROM portfolio_data WHERE type = $1 AND is_active = TRUE ORDER BY created_at ASC',
    [type]
  );
  return result.rows.map(row => row.value);
};

/**
 * Get records by type with additional filtering
 */
export const getPortfolioItemsByTypeWithFilter = async (type, filterFn = null) => {
  const items = await getPortfolioItemsByType(type);
  return filterFn ? items.filter(filterFn) : items;
};

/**
 * Set/Update individual record with versioning
 */
export const setPortfolioItem = async (key, type, value) => {
  return await transaction(async (client) => {
    // Deactivate current version
    await client.query(
      'UPDATE portfolio_data SET is_active = FALSE WHERE key = $1 AND is_active = TRUE',
      [key]
    );
    
    // Get next version number
    const versionResult = await client.query(
      'SELECT COALESCE(MAX(version), 0) + 1 as next_version FROM portfolio_data WHERE key = $1',
      [key]
    );
    
    const nextVersion = versionResult.rows[0].next_version;
    
    // Insert new version
    const result = await client.query(
      `INSERT INTO portfolio_data (key, type, value, version, is_active) 
       VALUES ($1, $2, $3, $4, TRUE) 
       RETURNING *`,
      [key, type, JSON.stringify(value), nextVersion]
    );
    
    return result.rows[0];
  });
};

/**
 * Delete individual record (soft delete)
 */
export const deletePortfolioItem = async (key) => {
  return await query(
    'UPDATE portfolio_data SET is_active = FALSE WHERE key = $1 AND is_active = TRUE RETURNING *',
    [key]
  );
};

/**
 * Get version history for a key
 */
export const getPortfolioItemHistory = async (key) => {
  const result = await query(
    'SELECT * FROM portfolio_data WHERE key = $1 ORDER BY version DESC',
    [key]
  );
  return result.rows;
};

/**
 * Rollback to specific version
 */
export const rollbackPortfolioItem = async (key, version) => {
  return await transaction(async (client) => {
    // Deactivate current version
    await client.query(
      'UPDATE portfolio_data SET is_active = FALSE WHERE key = $1 AND is_active = TRUE',
      [key]
    );
    
    // Activate target version
    const result = await client.query(
      'UPDATE portfolio_data SET is_active = TRUE WHERE key = $1 AND version = $2 RETURNING *',
      [key, version]
    );
    
    if (result.rows.length === 0) {
      throw new Error(`Version ${version} not found for key ${key}`);
    }
    
    return result.rows[0];
  });
};

/**
 * Get statistics by type
 */
export const getPortfolioStatsByType = async () => {
  const result = await query(`
    SELECT 
      type, 
      COUNT(*) as count,
      MAX(created_at) as last_updated
    FROM portfolio_data 
    WHERE is_active = TRUE 
    GROUP BY type
    ORDER BY type
  `);
  return result.rows;
};

// ============================================================================
// Specialized Helper Functions with Type-Based Queries
// ============================================================================

/**
 * PROFILE FUNCTIONS
 */
export const getProfile = async () => {
  return await getPortfolioItem('profile');
};

export const setProfile = async (profileData) => {
  return await setPortfolioItem('profile', 'profile', {
    ...profileData,
    updated_at: new Date().toISOString()
  });
};

/**
 * SKILLS FUNCTIONS
 */
export const getAllSkills = async () => {
  return await getPortfolioItemsByType('skill');
};

export const getSkillsByCategory = async (category) => {
  return await getPortfolioItemsByTypeWithFilter('skill', 
    skill => skill.category === category
  );
};

export const getFeaturedSkills = async () => {
  return await getPortfolioItemsByTypeWithFilter('skill',
    skill => skill.is_featured === true
  );
};

export const getSkillById = async (id) => {
  return await getPortfolioItem(`skill:${id}`);
};

export const createSkill = async (skillData) => {
  const key = `skill:${skillData.id}`;
  return await setPortfolioItem(key, 'skill', {
    ...skillData,
    created_at: new Date().toISOString()
  });
};

export const updateSkill = async (id, skillData) => {
  const key = `skill:${id}`;
  const currentSkill = await getPortfolioItem(key);
  
  if (!currentSkill) {
    throw new Error('Skill not found');
  }
  
  return await setPortfolioItem(key, 'skill', {
    ...currentSkill,
    ...skillData,
    id, // Preserve ID
    created_at: currentSkill.created_at, // Preserve created_at
    updated_at: new Date().toISOString()
  });
};

export const deleteSkill = async (id) => {
  return await deletePortfolioItem(`skill:${id}`);
};

/**
 * EXPERIENCES FUNCTIONS
 */
export const getAllExperiences = async () => {
  const experiences = await getPortfolioItemsByType('experience');
  const achievements = await getPortfolioItemsByType('achievement');
  
  // Group achievements by experience_id
  const achievementsByExperience = achievements.reduce((acc, achievement) => {
    const expId = achievement.experience_id;
    if (!acc[expId]) acc[expId] = [];
    acc[expId].push(achievement);
    return acc;
  }, {});
  
  // Attach achievements to experiences
  const experiencesWithAchievements = experiences.map(experience => ({
    ...experience,
    achievements: (achievementsByExperience[experience.id] || [])
      .sort((a, b) => a.sort_order - b.sort_order)
  }));
  
  return experiencesWithAchievements.sort((a, b) => a.sort_order - b.sort_order);
};

export const getExperienceById = async (id) => {
  return await getPortfolioItem(`experience:${id}`);
};

export const createExperience = async (experienceData) => {
  const key = `experience:${experienceData.id}`;
  return await setPortfolioItem(key, 'experience', {
    ...experienceData,
    created_at: new Date().toISOString()
  });
};

export const updateExperience = async (id, experienceData) => {
  const key = `experience:${id}`;
  const currentExperience = await getPortfolioItem(key);
  
  if (!currentExperience) {
    throw new Error('Experience not found');
  }
  
  return await setPortfolioItem(key, 'experience', {
    ...currentExperience,
    ...experienceData,
    id, // Preserve ID
    created_at: currentExperience.created_at,
    updated_at: new Date().toISOString()
  });
};

export const updateExperienceWithAchievements = async (id, experienceData, achievements = []) => {
  return await transaction(async (client) => {
    const experienceKey = `experience:${id}`;
    const currentExperience = await getPortfolioItem(experienceKey);
    
    if (!currentExperience) {
      throw new Error('Experience not found');
    }
    
    // Update experience in single atomic operation
    await client.query(
      'UPDATE portfolio_data SET is_active = FALSE WHERE key = $1 AND is_active = TRUE',
      [experienceKey]
    );
    
    const expVersionResult = await client.query(
      'SELECT COALESCE(MAX(version), 0) + 1 as next_version FROM portfolio_data WHERE key = $1',
      [experienceKey]
    );
    
    await client.query(
      `INSERT INTO portfolio_data (key, type, value, version, is_active) 
       VALUES ($1, $2, $3, $4, TRUE)`,
      [experienceKey, 'experience', JSON.stringify({
        ...currentExperience,
        ...experienceData,
        id,
        created_at: currentExperience.created_at,
        updated_at: new Date().toISOString()
      }), expVersionResult.rows[0].next_version]
    );
    
    // Atomically delete ALL existing achievements for this experience
    await client.query(
      `UPDATE portfolio_data SET is_active = FALSE 
       WHERE type = 'achievement' AND value->>'experience_id' = $1 AND is_active = TRUE`,
      [id]
    );
    
    // Atomically create ALL new achievements
    const createdAchievements = [];
    for (let i = 0; i < achievements.length; i++) {
      const achievementKey = `achievement:${achievements[i].id || uuid()}`;
      const achievementData = {
        id: achievements[i].id || uuid(),
        experience_id: id,
        description: achievements[i].description,
        icon_name: achievements[i].icon_name,
        metrics: achievements[i].metrics,
        sort_order: achievements[i].sort_order || i,
        created_at: new Date().toISOString()
      };
      
      await client.query(
        `INSERT INTO portfolio_data (key, type, value, version, is_active) 
         VALUES ($1, $2, $3, 1, TRUE)`,
        [achievementKey, 'achievement', JSON.stringify(achievementData)]
      );
      
      createdAchievements.push(achievementData);
    }
    
    return {
      ...currentExperience,
      ...experienceData,
      id,
      achievements: createdAchievements
    };
  });
};

export const deleteExperience = async (id) => {
  // Also delete related achievements
  const achievements = await getAchievementsForExperience(id);
  for (const achievement of achievements) {
    await deletePortfolioItem(`achievement:${achievement.id}`);
  }
  
  return await deletePortfolioItem(`experience:${id}`);
};

/**
 * ACHIEVEMENTS FUNCTIONS
 */
export const getAchievementsForExperience = async (experienceId) => {
  return await getPortfolioItemsByTypeWithFilter('achievement',
    achievement => achievement.experience_id === experienceId
  );
};

export const getAchievementById = async (id) => {
  return await getPortfolioItem(`achievement:${id}`);
};

export const createAchievement = async (achievementData) => {
  const key = `achievement:${achievementData.id}`;
  return await setPortfolioItem(key, 'achievement', {
    ...achievementData,
    created_at: new Date().toISOString()
  });
};

export const updateAchievement = async (id, achievementData) => {
  const key = `achievement:${id}`;
  const currentAchievement = await getPortfolioItem(key);
  
  if (!currentAchievement) {
    throw new Error('Achievement not found');
  }
  
  return await setPortfolioItem(key, 'achievement', {
    ...currentAchievement,
    ...achievementData,
    id, // Preserve ID
    created_at: currentAchievement.created_at,
    updated_at: new Date().toISOString()
  });
};

export const deleteAchievement = async (id) => {
  return await deletePortfolioItem(`achievement:${id}`);
};

/**
 * PROJECTS FUNCTIONS
 */
export const getAllProjects = async () => {
  const projects = await getPortfolioItemsByType('project');
  const technologies = await getPortfolioItemsByType('project_tech');
  const images = await getPortfolioItemsByType('project_image');
  
  // Group technologies by project_id
  const technologiesByProject = technologies.reduce((acc, tech) => {
    const projectId = tech.project_id;
    if (!acc[projectId]) acc[projectId] = [];
    acc[projectId].push(tech.technology);
    return acc;
  }, {});
  
  // Group images by project_id
  const imagesByProject = images.reduce((acc, image) => {
    const projectId = image.project_id;
    if (!acc[projectId]) acc[projectId] = [];
    acc[projectId].push(image);
    return acc;
  }, {});
  
  // Attach technologies and images to projects
  const projectsWithDetails = projects.map(project => ({
    ...project,
    technologies: technologiesByProject[project.id] || [],
    images: (imagesByProject[project.id] || [])
      .sort((a, b) => a.sort_order - b.sort_order)
  }));
  
  return projectsWithDetails.sort((a, b) => a.sort_order - b.sort_order);
};

export const getProjectsByStatus = async (status) => {
  return await getPortfolioItemsByTypeWithFilter('project',
    project => project.status === status
  );
};

export const getFeaturedProjects = async () => {
  return await getPortfolioItemsByTypeWithFilter('project',
    project => project.is_featured === true
  );
};

export const getProjectById = async (id) => {
  const project = await getPortfolioItem(`project:${id}`);
  if (!project) return null;
  
  // Get associated technologies and images
  const technologies = await getTechnologiesForProject(id);
  const images = await getImagesForProject(id);
  
  return {
    ...project,
    technologies: technologies.map(tech => tech.technology),
    images: images.sort((a, b) => a.sort_order - b.sort_order)
  };
};

export const getProjectBySlug = async (slug) => {
  const projects = await getPortfolioItemsByTypeWithFilter('project',
    project => project.slug === slug
  );
  
  if (projects.length === 0) return null;
  
  const project = projects[0];
  const technologies = await getTechnologiesForProject(project.id);
  const images = await getImagesForProject(project.id);
  
  return {
    ...project,
    technologies: technologies.map(tech => tech.technology),
    images: images.sort((a, b) => a.sort_order - b.sort_order)
  };
};

export const createProject = async (projectData) => {
  return await transaction(async (client) => {
    const projectKey = `project:${projectData.id}`;
    
    // Create main project record
    await client.query(
      `INSERT INTO portfolio_data (key, type, value, version, is_active) 
       VALUES ($1, $2, $3, 1, TRUE)`,
      [projectKey, 'project', JSON.stringify({
        ...projectData,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      })]
    );
    
    // Create technology records
    if (projectData.technologies && projectData.technologies.length > 0) {
      for (const technology of projectData.technologies) {
        const techKey = `project_tech:${projectData.id}:${technology}`;
        await client.query(
          `INSERT INTO portfolio_data (key, type, value, version, is_active) 
           VALUES ($1, $2, $3, 1, TRUE)`,
          [techKey, 'project_tech', JSON.stringify({
            project_id: projectData.id,
            technology,
            created_at: new Date().toISOString()
          })]
        );
      }
    }
    
    return projectData;
  });
};

export const updateProject = async (id, projectData) => {
  return await transaction(async (client) => {
    const projectKey = `project:${id}`;
    const currentProject = await getPortfolioItem(projectKey);
    
    if (!currentProject) {
      throw new Error('Project not found');
    }
    
    // Update main project record
    await client.query(
      'UPDATE portfolio_data SET is_active = FALSE WHERE key = $1 AND is_active = TRUE',
      [projectKey]
    );
    
    const nextVersion = await client.query(
      'SELECT COALESCE(MAX(version), 0) + 1 as next_version FROM portfolio_data WHERE key = $1',
      [projectKey]
    );
    
    await client.query(
      `INSERT INTO portfolio_data (key, type, value, version, is_active) 
       VALUES ($1, $2, $3, $4, TRUE)`,
      [projectKey, 'project', JSON.stringify({
        ...currentProject,
        ...projectData,
        id, // Preserve ID
        created_at: currentProject.created_at,
        updated_at: new Date().toISOString()
      }), nextVersion.rows[0].next_version]
    );
    
    // Update technologies if provided
    if (projectData.technologies !== undefined) {
      // Delete existing technologies
      await client.query(
        `UPDATE portfolio_data SET is_active = FALSE 
         WHERE type = 'project_tech' AND value->>'project_id' = $1 AND is_active = TRUE`,
        [id]
      );
      
      // Add new technologies
      for (const technology of projectData.technologies) {
        const techKey = `project_tech:${id}:${technology}`;
        await client.query(
          `INSERT INTO portfolio_data (key, type, value, version, is_active) 
           VALUES ($1, $2, $3, 1, TRUE)`,
          [techKey, 'project_tech', JSON.stringify({
            project_id: id,
            technology,
            created_at: new Date().toISOString()
          })]
        );
      }
    }
    
    return { ...currentProject, ...projectData, id };
  });
};

export const deleteProject = async (id) => {
  return await transaction(async (client) => {
    // Delete project technologies
    await client.query(
      `UPDATE portfolio_data SET is_active = FALSE 
       WHERE type = 'project_tech' AND value->>'project_id' = $1 AND is_active = TRUE`,
      [id]
    );
    
    // Delete project images
    await client.query(
      `UPDATE portfolio_data SET is_active = FALSE 
       WHERE type = 'project_image' AND value->>'project_id' = $1 AND is_active = TRUE`,
      [id]
    );
    
    // Delete main project
    return await client.query(
      'UPDATE portfolio_data SET is_active = FALSE WHERE key = $1 AND is_active = TRUE RETURNING *',
      [`project:${id}`]
    );
  });
};

/**
 * PROJECT TECHNOLOGIES FUNCTIONS
 */
export const getTechnologiesForProject = async (projectId) => {
  return await getPortfolioItemsByTypeWithFilter('project_tech',
    tech => tech.project_id === projectId
  );
};

/**
 * PROJECT IMAGES FUNCTIONS
 */
export const getImagesForProject = async (projectId) => {
  return await getPortfolioItemsByTypeWithFilter('project_image',
    image => image.project_id === projectId
  );
};

export const createProjectImage = async (imageData) => {
  const key = `project_image:${imageData.id}`;
  return await setPortfolioItem(key, 'project_image', {
    ...imageData,
    created_at: new Date().toISOString()
  });
};

export const updateProjectImage = async (id, imageData) => {
  const key = `project_image:${id}`;
  const currentImage = await getPortfolioItem(key);
  
  if (!currentImage) {
    throw new Error('Project image not found');
  }
  
  return await setPortfolioItem(key, 'project_image', {
    ...currentImage,
    ...imageData,
    id, // Preserve ID
    created_at: currentImage.created_at,
    updated_at: new Date().toISOString()
  });
};

export const deleteProjectImage = async (id) => {
  return await deletePortfolioItem(`project_image:${id}`);
};

/**
 * BULK OPERATIONS - All operations wrapped in single transactions to prevent race conditions
 */
export const updateSkillsOrder = async (skillsWithOrder) => {
  return await transaction(async (client) => {
    for (const { id, sort_order } of skillsWithOrder) {
      const key = `skill:${id}`;
      const currentSkill = await getPortfolioItem(key);
      
      if (currentSkill) {
        await client.query(
          'UPDATE portfolio_data SET is_active = FALSE WHERE key = $1 AND is_active = TRUE',
          [key]
        );
        
        const nextVersion = await client.query(
          'SELECT COALESCE(MAX(version), 0) + 1 as next_version FROM portfolio_data WHERE key = $1',
          [key]
        );
        
        await client.query(
          `INSERT INTO portfolio_data (key, type, value, version, is_active) 
           VALUES ($1, $2, $3, $4, TRUE)`,
          [key, 'skill', JSON.stringify({
            ...currentSkill,
            sort_order,
            updated_at: new Date().toISOString()
          }), nextVersion.rows[0].next_version]
        );
      }
    }
  });
};

export const updateExperiencesOrder = async (experiencesWithOrder) => {
  return await transaction(async (client) => {
    for (const { id, sort_order } of experiencesWithOrder) {
      const key = `experience:${id}`;
      const currentExperience = await getPortfolioItem(key);
      
      if (currentExperience) {
        await client.query(
          'UPDATE portfolio_data SET is_active = FALSE WHERE key = $1 AND is_active = TRUE',
          [key]
        );
        
        const nextVersion = await client.query(
          'SELECT COALESCE(MAX(version), 0) + 1 as next_version FROM portfolio_data WHERE key = $1',
          [key]
        );
        
        await client.query(
          `INSERT INTO portfolio_data (key, type, value, version, is_active) 
           VALUES ($1, $2, $3, $4, TRUE)`,
          [key, 'experience', JSON.stringify({
            ...currentExperience,
            sort_order,
            updated_at: new Date().toISOString()
          }), nextVersion.rows[0].next_version]
        );
      }
    }
  });
};

export const updateProjectsOrder = async (projectsWithOrder) => {
  return await transaction(async (client) => {
    for (const { id, sort_order } of projectsWithOrder) {
      const key = `project:${id}`;
      const currentProject = await getPortfolioItem(key);
      
      if (currentProject) {
        await client.query(
          'UPDATE portfolio_data SET is_active = FALSE WHERE key = $1 AND is_active = TRUE',
          [key]
        );
        
        const nextVersion = await client.query(
          'SELECT COALESCE(MAX(version), 0) + 1 as next_version FROM portfolio_data WHERE key = $1',
          [key]
        );
        
        await client.query(
          `INSERT INTO portfolio_data (key, type, value, version, is_active) 
           VALUES ($1, $2, $3, $4, TRUE)`,
          [key, 'project', JSON.stringify({
            ...currentProject,
            sort_order,
            updated_at: new Date().toISOString()
          }), nextVersion.rows[0].next_version]
        );
      }
    }
  });
};

/**
 * DASHBOARD STATISTICS
 */
export const getDashboardStats = async () => {
  const stats = await getPortfolioStatsByType();
  
  // Additional computed stats
  const skillsWithFeatured = await getAllSkills();
  const projectsWithStatus = await getAllProjects();
  const experiences = await getAllExperiences();
  
  const featuredSkillsCount = skillsWithFeatured.filter(skill => skill.is_featured).length;
  const publishedProjectsCount = projectsWithStatus.filter(project => project.status === 'published').length;
  const totalAchievements = experiences.reduce((sum, exp) => sum + (exp.achievements?.length || 0), 0);
  
  return {
    totalStats: Object.fromEntries(stats.map(row => [row.type, parseInt(row.count)])),
    featuredSkills: featuredSkillsCount,
    publishedProjects: publishedProjectsCount,
    totalAchievements,
    lastUpdated: Math.max(...stats.map(row => new Date(row.last_updated).getTime()))
  };
};