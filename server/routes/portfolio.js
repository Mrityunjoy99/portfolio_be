import express from 'express';
import { getCachedPortfolioData } from '../config/portfolio-cache.js';

const router = express.Router();

// Get all portfolio data in a single API call (public endpoint)
router.get('/data', async (req, res) => {
  try {
    // Disable ETag generation to prevent 304 responses
    res.set('ETag', false);
    
    // Set cache control headers based on environment
    if (process.env.NODE_ENV === 'production') {
      // Cache for 5 minutes in production but allow revalidation
      res.set({
        'Cache-Control': 'public, max-age=300, must-revalidate',
        'Expires': new Date(Date.now() + 300000).toUTCString()
      });
    } else {
      // No caching in development
      res.set({
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        'Pragma': 'no-cache',
        'Expires': '0'
      });
    }
    
    // Fetch portfolio data from cache (with stale-while-revalidate pattern)
    const portfolioData = await getCachedPortfolioData();

    res.json(portfolioData);
  } catch (error) {
    console.error('Get portfolio data error:', error);
    res.status(500).json({ error: 'Failed to get portfolio data' });
  }
});

export default router;