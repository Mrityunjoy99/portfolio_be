/**
 * Enhanced Portfolio Cache System
 * 
 * This module provides a resilient caching layer with:
 * - Individual key-based caching (not single blob)
 * - DataProvider interface for extensibility
 * - Smart data accessor with fallback logic
 * - Resilient refresh with retry/backoff
 * - Support for future table caching
 */

import NodeCache from 'node-cache';
import { query } from './database.js';

// Simplified cache configuration
const CACHE_CONFIG = {
  ENABLED: process.env.PORTFOLIO_CACHE_ENABLED == 'true',
  REFRESH_INTERVAL: parseInt(process.env.PORTFOLIO_CACHE_REFRESH_INTERVAL) || 1800 // seconds
};

// Static cache instance (no TTL, no LRU, unlimited keys)
const cache = new NodeCache({
  stdTTL: 0,        // No expiration
  checkperiod: 0,   // No cleanup checks
  useClones: false, // Better performance
  deleteOnExpire: false,
  maxKeys: -1       // Unlimited keys
});

// ============================================================================
// DataProvider Interface Implementations
// ============================================================================

/**
 * Cache Provider - manages individual cache keys
 */
class CacheProvider {
  async getItem(key) {
    return cache.get(key) || null;
  }

  async setItem(key, value) {
    return cache.set(key, value);
  }

  async deleteItem(key) {
    return cache.del(key);
  }

  async getAllItems(keyPrefix = '') {
    const keys = cache.keys().filter(key => key.startsWith(keyPrefix));
    const items = {};
    keys.forEach(key => {
      items[key] = cache.get(key);
    });
    return items;
  }

  async clear() {
    cache.flushAll();
  }

  getStats() {
    return {
      keys: cache.keys().length,
      stats: cache.getStats()
    };
  }
}

/**
 * Database Provider - wraps direct database queries
 */
class DatabaseProvider {
  async getItem(key) {
    try {
      const result = await query(
        'SELECT value FROM portfolio_data WHERE key = $1 AND is_active = TRUE',
        [key]
      );
      return result.rows[0]?.value || null;
    } catch (error) {
      console.error(`DB getItem error for key ${key}:`, error);
      throw error;
    }
  }

  async setItem(key, value, type = 'unknown') {
    try {
      // This would be handled by existing portfolio-data.js functions
      // Just a placeholder for interface completeness
      throw new Error('Use portfolio-data.js functions for DB writes');
    } catch (error) {
      console.error(`DB setItem error for key ${key}:`, error);
      throw error;
    }
  }

  async deleteItem(key) {
    try {
      // This would be handled by existing portfolio-data.js functions
      throw new Error('Use portfolio-data.js functions for DB deletes');
    } catch (error) {
      console.error(`DB deleteItem error for key ${key}:`, error);
      throw error;
    }
  }

  async getAllItems(tablePrefix = 'portfolio_data') {
    try {
      let whereClause = 'is_active = TRUE';
      let queryText = `SELECT key, value, type FROM ${tablePrefix} WHERE ${whereClause} ORDER BY type, created_at ASC`;
      
      const result = await query(queryText);
      const items = {};
      result.rows.forEach(row => {
        items[row.key] = {
          ...row.value,
          _dbType: row.type  // Add database type for processing
        };
      });
      return items;
    } catch (error) {
      console.error(`DB getAllItems error:`, error);
      throw error;
    }
  }

  async isHealthy() {
    try {
      await query('SELECT 1');
      return true;
    } catch (error) {
      console.error('DB health check failed:', error);
      return false;
    }
  }
}

// ============================================================================
// Smart Data Accessor
// ============================================================================

/**
 * Portfolio Data Accessor - intelligent routing between cache and DB
 */
class PortfolioDataAccessor {
  constructor() {
    this.cacheProvider = new CacheProvider();
    this.dbProvider = new DatabaseProvider();
  }

  /**
   * Get portfolio data with smart routing
   */
  async getPortfolioData() {
    try {
      // If cache disabled, always use DB
      if (!CACHE_CONFIG.ENABLED) {
        console.log('Cache disabled, fetching from database');
        return await this.fetchAndProcessFromDB();
      }

      // Try cache first
      const cachedItems = await this.cacheProvider.getAllItems('portfolio_data:');
      const cacheKeys = Object.keys(cachedItems);

      if (cacheKeys.length > 0) {
        console.log(`Serving from cache (${cacheKeys.length} items)`);
        return this.processPortfolioItems(cachedItems);
      }

      // Fallback to DB if cache empty
      console.log('Cache empty, fallback to database');
      return await this.fetchAndProcessFromDB();

    } catch (error) {
      console.error('Error in getPortfolioData:', error);
      // Last resort: try DB directly
      return await this.fetchAndProcessFromDB();
    }
  }

  /**
   * Fetch from database and process
   */
  async fetchAndProcessFromDB() {
    const dbItems = await this.dbProvider.getAllItems('portfolio_data');
    return this.processPortfolioItems(dbItems);
  }

  /**
   * Process raw portfolio items into structured data
   */
  processPortfolioItems(items) {
    const dataByType = {};
    
    // Group items by type
    Object.values(items).forEach(item => {
      const type = this.getTypeFromItem(item);
      if (!dataByType[type]) dataByType[type] = [];
      dataByType[type].push(item);
    });

    // Extract and process each type
    const profile = dataByType.profile?.[0] || null;
    const skills = this.processFeaturedSkills(dataByType.skill || []);
    const experiences = this.processExperiencesWithAchievements(
      dataByType.experience || [], 
      dataByType.achievement || []
    );
    const projects = this.processProjectsWithTech(
      dataByType.project || [],
      dataByType.project_tech || [],
      dataByType.project_image || []
    );

    return { profile, skills, experiences, projects };
  }

  /**
   * Determine type from portfolio item
   */
  getTypeFromItem(item) {
    // Use database type if available
    if (item._dbType) {
      return item._dbType;
    }
    
    // Fallback to structure-based detection
    if (item.name && item.category) return 'skill';
    if (item.company && item.position) return 'experience';
    if (item.experience_id) return 'achievement';
    if (item.title && item.slug) return 'project';
    if (item.project_id && item.technology) return 'project_tech';
    if (item.project_id && item.image_url) return 'project_image';
    return 'profile';
  }

  /**
   * Process skills with featured filtering and sorting
   */
  processFeaturedSkills(allSkills) {
    const skills = allSkills.filter(skill => skill.is_featured === true);
    
    return skills.sort((a, b) => {
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
  }

  /**
   * Process experiences with achievements
   */
  processExperiencesWithAchievements(experiences, achievements) {
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
  }

  /**
   * Process projects with technologies and images
   */
  processProjectsWithTech(projects, technologies, images) {
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

    // Filter to published projects and attach related data
    const projectsWithDetails = projects
      .filter(project => project.status === 'published')
      .map(project => ({
        ...project,
        technologies: technologiesByProject[project.id] || [],
        images: (imagesByProject[project.id] || [])
          .sort((a, b) => a.sort_order - b.sort_order)
      }));

    return projectsWithDetails.sort((a, b) => a.sort_order - b.sort_order);
  }

  /**
   * Update cache item
   */
  async updateCacheItem(key, value) {
    if (!CACHE_CONFIG.ENABLED) return;
    
    const cacheKey = `portfolio_data:${key}`;
    await this.cacheProvider.setItem(cacheKey, value);
    console.log(`Cache updated for key: ${cacheKey}`);
  }

  /**
   * Delete cache item
   */
  async deleteCacheItem(key) {
    if (!CACHE_CONFIG.ENABLED) return;
    
    const cacheKey = `portfolio_data:${key}`;
    await this.cacheProvider.deleteItem(cacheKey);
    console.log(`Cache deleted for key: ${cacheKey}`);
  }

  /**
   * Get cache status
   */
  getCacheStatus() {
    return {
      enabled: CACHE_CONFIG.ENABLED,
      config: {
        refreshInterval: CACHE_CONFIG.REFRESH_INTERVAL
      },
      stats: this.cacheProvider.getStats()
    };
  }
}

// ============================================================================
// Resilient Cache Refresh System
// ============================================================================

class CacheRefreshManager {
  constructor(accessor) {
    this.accessor = accessor;
    this.refreshTimer = null;
    this.isRefreshing = false;
  }

  async initialize() {
    if (!CACHE_CONFIG.ENABLED) {
      console.log('Portfolio cache disabled');
      return;
    }

    console.log(`Initializing portfolio cache with ${CACHE_CONFIG.REFRESH_INTERVAL}s refresh interval`);
    
    // Initial cache population
    await this.refreshCacheWithRetry();
    
    // Set up periodic refresh
    this.startPeriodicRefresh();
    
    console.log('Portfolio cache initialized successfully');
  }

  startPeriodicRefresh() {
    if (this.refreshTimer) {
      clearInterval(this.refreshTimer);
      this.refreshTimer = null;
    }
    
    this.refreshTimer = setInterval(async () => {
      console.log('Starting periodic cache refresh...');
      await this.refreshCacheWithRetry();
    }, CACHE_CONFIG.REFRESH_INTERVAL * 1000);
    
    // Ensure timer doesn't keep the process alive unnecessarily
    this.refreshTimer.unref();
  }

  async refreshCacheWithRetry() {
    if (this.isRefreshing) {
      console.log('Refresh already in progress, skipping...');
      return;
    }

    this.isRefreshing = true;

    try {
      // Check DB health before invalidating cache
      const isHealthy = await this.accessor.dbProvider.isHealthy();
      if (!isHealthy) {
        console.log('DB unhealthy, keeping existing cache');
        return;
      }

      // Retry logic with exponential backoff
      const maxRetries = 3;
      const baseDelay = 1000;

      for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
          console.log(`Fetching fresh data from database (attempt ${attempt}/${maxRetries})`);
          
          // Fetch fresh data from DB
          const freshItems = await this.accessor.dbProvider.getAllItems('portfolio_data');
          
          // Only invalidate cache AFTER successful DB fetch
          await this.accessor.cacheProvider.clear();
          console.log('Cache invalidated after successful DB fetch');
          
          // Populate cache with fresh data
          const populatedKeys = [];
          for (const [key, value] of Object.entries(freshItems)) {
            const cacheKey = `portfolio_data:${key}`;
            await this.accessor.cacheProvider.setItem(cacheKey, value);
            populatedKeys.push(cacheKey);
          }
          
          console.log(`Cache refreshed successfully with ${populatedKeys.length} items`);
          return;

        } catch (error) {
          console.error(`Cache refresh attempt ${attempt} failed:`, error);
          
          if (attempt === maxRetries) {
            console.log('All refresh attempts failed, keeping existing cache until next interval');
            return;
          }
          
          // Exponential backoff
          const delay = baseDelay * Math.pow(2, attempt - 1);
          console.log(`Retrying in ${delay}ms...`);
          await this.sleep(delay);
        }
      }

    } finally {
      this.isRefreshing = false;
    }
  }

  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  stop() {
    if (this.refreshTimer) {
      clearInterval(this.refreshTimer);
      this.refreshTimer = null;
      console.log('Cache refresh timer stopped');
    }
    
    // Cancel any ongoing refresh
    if (this.isRefreshing) {
      console.log('Cancelling ongoing cache refresh');
      this.isRefreshing = false;
    }
  }

  async clearCache() {
    await this.accessor.cacheProvider.clear();
    console.log('Cache cleared manually');
  }

  async forceRefresh() {
    await this.refreshCacheWithRetry();
  }
}

// ============================================================================
// Main Exports - Singleton Pattern
// ============================================================================

// Create singleton instances
const portfolioAccessor = new PortfolioDataAccessor();
const refreshManager = new CacheRefreshManager(portfolioAccessor);

// Main API functions
export const initializeCache = async () => {
  await refreshManager.initialize();
};

export const getCachedPortfolioData = async () => {
  return await portfolioAccessor.getPortfolioData();
};

export const updateCacheItem = async (key, value) => {
  await portfolioAccessor.updateCacheItem(key, value);
};

export const deleteCacheItem = async (key) => {
  await portfolioAccessor.deleteCacheItem(key);
};

export const getCacheStatus = () => {
  return portfolioAccessor.getCacheStatus();
};

export const clearCache = async () => {
  await refreshManager.clearCache();
};

export const invalidateCache = async () => {
  await refreshManager.forceRefresh();
};

export const getAllCacheKeys = async () => {
  return await portfolioAccessor.cacheProvider.getAllItems('portfolio_data:');
};

export const shutdownCache = () => {
  try {
    console.log('Shutting down portfolio cache...');
    refreshManager.stop();
    
    // Close the cache instance
    cache.close();
    
    console.log('Portfolio cache shutdown complete');
  } catch (error) {
    console.error('Error during cache shutdown:', error);
  }
};

// Note: Process event handlers are managed by the main server (server/index.js)
// to avoid conflicts and ensure proper shutdown order