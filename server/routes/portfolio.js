import express from 'express';
import { 
  getProfile,
  getAllSkills,
  getAllExperiences,
  getAllProjects
} from '../config/portfolio-data.js';

const router = express.Router();

// Get all portfolio data in a single API call (public endpoint)
router.get('/data', async (req, res) => {
  try {
    // Fetch all portfolio data in parallel for better performance
    const [profile, skills, experiences, projects] = await Promise.all([
      getProfile(),
      getAllSkills(),
      getAllExperiences(),
      getAllProjects()
    ]);

    // Sort skills by proficiency and sort order
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

    // Filter projects to only show published ones for public access
    const publishedProjects = projects.filter(project => project.status === 'published');

    const portfolioData = {
      profile,
      skills,
      experiences,
      projects: publishedProjects
    };

    res.json(portfolioData);
  } catch (error) {
    console.error('Get portfolio data error:', error);
    res.status(500).json({ error: 'Failed to get portfolio data' });
  }
});

export default router;