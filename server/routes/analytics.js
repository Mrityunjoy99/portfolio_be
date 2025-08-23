import express from 'express';
import { query } from '../config/database.js';
import rateLimit from 'express-rate-limit';
import { authenticate } from '../middleware/auth.js';

const router = express.Router();

// Rate limiting for analytics endpoints - more permissive for user tracking
const analyticsLimiter = rateLimit({
  windowMs: 5 * 60 * 1000, // 5 minutes
  max: 1000, // limit each IP to 1000 requests per 5 minutes (much more permissive)
  message: 'Too many analytics requests from this IP, please try again later.',
  standardHeaders: true, // Return rate limit info in the `RateLimit-*` headers
  legacyHeaders: false, // Disable the `X-RateLimit-*` headers
});

// Apply rate limiting to all analytics routes
router.use(analyticsLimiter);

// Helper function to get real IP address
function getRealIpAddress(req) {
  return req.headers['x-forwarded-for']?.split(',')[0]?.trim() ||
         req.headers['x-real-ip'] ||
         req.headers['x-client-ip'] ||
         req.connection?.remoteAddress ||
         req.socket?.remoteAddress ||
         req.ip ||
         'unknown';
}

// Initialize session endpoint (public, no auth required)
router.post('/session', async (req, res) => {
  try {
    const {
      sessionId,
      ipAddress,
      userAgent,
      country,
      city,
      region,
      deviceType,
      browserName,
      browserVersion,
      osName,
      screenWidth,
      screenHeight,
      referrerUrl,
      referrerDomain,
      utmSource,
      utmMedium,
      utmCampaign,
      additionalData
    } = req.body;

    // Use server-side IP if client-side IP not provided
    const finalIpAddress = ipAddress || getRealIpAddress(req);

    // Validate required fields
    if (!sessionId) {
      return res.status(400).json({ error: 'Session ID is required' });
    }

    // Insert new visitor session or update existing
    const result = await query(
      `INSERT INTO visitor_analytics (
        session_id, ip_address, user_agent, country, city, region,
        device_type, browser_name, browser_version, os_name,
        screen_width, screen_height, referrer_url, referrer_domain,
        utm_source, utm_medium, utm_campaign, additional_data
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)
      ON CONFLICT (session_id) DO UPDATE SET
        last_activity = NOW(),
        page_views = visitor_analytics.page_views + 1,
        is_bounce = FALSE
      RETURNING *`,
      [
        sessionId,
        finalIpAddress,
        userAgent,
        country,
        city,
        region,
        deviceType,
        browserName,
        browserVersion,
        osName,
        screenWidth,
        screenHeight,
        referrerUrl,
        referrerDomain,
        utmSource,
        utmMedium,
        utmCampaign,
        JSON.stringify(additionalData)
      ]
    );

    res.status(201).json({
      message: 'Session initialized successfully',
      session: result.rows[0]
    });
  } catch (error) {
    console.error('Analytics session error:', error);
    res.status(500).json({ error: 'Failed to initialize session' });
  }
});

// Track page view endpoint (public, no auth required)
router.post('/pageview', async (req, res) => {
  try {
    const {
      sessionId,
      pagePath,
      pageTitle,
      viewDuration,
      scrollDepth,
      entryPage,
      exitPage
    } = req.body;

    // Validate required fields
    if (!sessionId || !pagePath) {
      return res.status(400).json({ error: 'Session ID and page path are required' });
    }

    // Insert page view event
    const result = await query(
      `INSERT INTO page_views (
        session_id, page_path, page_title, view_duration,
        scroll_depth, entry_page, exit_page
      ) VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING *`,
      [sessionId, pagePath, pageTitle, viewDuration, scrollDepth, entryPage, exitPage]
    );

    // Update session last activity and page views
    await query(
      `UPDATE visitor_analytics 
       SET last_activity = NOW(), 
           page_views = page_views + 1,
           is_bounce = CASE WHEN page_views = 1 AND $1 > 30 THEN FALSE ELSE is_bounce END
       WHERE session_id = $2`,
      [viewDuration || 0, sessionId]
    );

    res.status(201).json({
      message: 'Page view tracked successfully',
      pageView: result.rows[0]
    });
  } catch (error) {
    console.error('Analytics page view error:', error);
    res.status(500).json({ error: 'Failed to track page view' });
  }
});

// Track user events endpoint (public, no auth required)
router.post('/event', async (req, res) => {
  try {
    const {
      sessionId,
      eventType,
      eventCategory,
      elementId,
      elementText,
      targetUrl,
      pagePath,
      additionalData
    } = req.body;

    // Validate required fields
    if (!sessionId || !eventType) {
      return res.status(400).json({ error: 'Session ID and event type are required' });
    }

    // Insert user event
    const result = await query(
      `INSERT INTO user_events (
        session_id, event_type, event_category, element_id,
        element_text, target_url, page_path, additional_data
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      RETURNING *`,
      [
        sessionId,
        eventType,
        eventCategory,
        elementId,
        elementText,
        targetUrl,
        pagePath,
        JSON.stringify(additionalData)
      ]
    );

    // Update session last activity
    await query(
      `UPDATE visitor_analytics 
       SET last_activity = NOW(),
           is_bounce = FALSE
       WHERE session_id = $1`,
      [sessionId]
    );

    res.status(201).json({
      message: 'Event tracked successfully',
      event: result.rows[0]
    });
  } catch (error) {
    console.error('Analytics event error:', error);
    res.status(500).json({ error: 'Failed to track event' });
  }
});

// Track performance metrics endpoint (public, no auth required)
router.post('/performance', async (req, res) => {
  try {
    const {
      sessionId,
      pagePath,
      loadTime,
      domReadyTime,
      firstPaintTime,
      largestContentfulPaint,
      cumulativeLayoutShift
    } = req.body;

    // Validate required fields
    if (!sessionId || !pagePath) {
      return res.status(400).json({ error: 'Session ID and page path are required' });
    }

    // Insert performance metrics
    const result = await query(
      `INSERT INTO performance_metrics (
        session_id, page_path, load_time, dom_ready_time,
        first_paint_time, largest_contentful_paint, cumulative_layout_shift
      ) VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING *`,
      [
        sessionId,
        pagePath,
        loadTime,
        domReadyTime,
        firstPaintTime,
        largestContentfulPaint,
        cumulativeLayoutShift
      ]
    );

    res.status(201).json({
      message: 'Performance metrics tracked successfully',
      metrics: result.rows[0]
    });
  } catch (error) {
    console.error('Analytics performance error:', error);
    res.status(500).json({ error: 'Failed to track performance metrics' });
  }
});

// Update session duration endpoint (public, no auth required)
router.put('/session/:sessionId', async (req, res) => {
  try {
    const { sessionId } = req.params;
    const { sessionDuration } = req.body;

    // Validate required fields
    if (!sessionDuration) {
      return res.status(400).json({ error: 'Session duration is required' });
    }

    // Update session duration
    const result = await query(
      `UPDATE visitor_analytics 
       SET session_duration = $1, 
           last_activity = NOW(),
           is_bounce = CASE WHEN $1 > 30 THEN FALSE ELSE is_bounce END
       WHERE session_id = $2
       RETURNING *`,
      [sessionDuration, sessionId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Session not found' });
    }

    res.json({
      message: 'Session updated successfully',
      session: result.rows[0]
    });
  } catch (error) {
    console.error('Analytics session update error:', error);
    res.status(500).json({ error: 'Failed to update session' });
  }
});

// Dashboard overview stats (auth required)
router.get('/dashboard', authenticate, async (req, res) => {
  try {
    // Get date range from query params (default to last 30 days)
    const daysBack = parseInt(req.query.days) || 30;
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - daysBack);

    // Get overview statistics
    const [
      totalVisitors,
      totalPageViews,
      avgSessionDuration,
      bounceRate,
      topPages,
      topCountries,
      deviceBreakdown,
      recentEvents
    ] = await Promise.all([
      // Total visitors
      query(
        'SELECT COUNT(*) as total FROM visitor_analytics WHERE created_at >= $1',
        [startDate]
      ),
      // Total page views
      query(
        'SELECT COUNT(*) as total FROM page_views WHERE timestamp >= $1',
        [startDate]
      ),
      // Average session duration
      query(
        'SELECT AVG(session_duration) as avg_duration FROM visitor_analytics WHERE created_at >= $1',
        [startDate]
      ),
      // Bounce rate
      query(
        'SELECT (COUNT(CASE WHEN is_bounce = true THEN 1 END) * 100.0 / COUNT(*)) as bounce_rate FROM visitor_analytics WHERE created_at >= $1',
        [startDate]
      ),
      // Top pages
      query(
        'SELECT page_path, COUNT(*) as views FROM page_views WHERE timestamp >= $1 GROUP BY page_path ORDER BY views DESC LIMIT 10',
        [startDate]
      ),
      // Top countries
      query(
        'SELECT country, COUNT(*) as visitors FROM visitor_analytics WHERE created_at >= $1 AND country IS NOT NULL GROUP BY country ORDER BY visitors DESC LIMIT 10',
        [startDate]
      ),
      // Device breakdown
      query(
        'SELECT device_type, COUNT(*) as count FROM visitor_analytics WHERE created_at >= $1 AND device_type IS NOT NULL GROUP BY device_type ORDER BY count DESC',
        [startDate]
      ),
      // Recent events
      query(
        'SELECT event_type, COUNT(*) as count FROM user_events WHERE timestamp >= $1 GROUP BY event_type ORDER BY count DESC LIMIT 10',
        [startDate]
      )
    ]);

    const dashboardStats = {
      overview: {
        totalVisitors: parseInt(totalVisitors.rows[0].total),
        totalPageViews: parseInt(totalPageViews.rows[0].total),
        avgSessionDuration: Math.round(parseFloat(avgSessionDuration.rows[0].avg_duration) || 0),
        bounceRate: Math.round(parseFloat(bounceRate.rows[0].bounce_rate) || 0)
      },
      topPages: topPages.rows,
      topCountries: topCountries.rows,
      deviceBreakdown: deviceBreakdown.rows,
      recentEvents: recentEvents.rows,
      dateRange: {
        startDate: startDate.toISOString(),
        endDate: new Date().toISOString(),
        days: daysBack
      }
    };

    res.json({ stats: dashboardStats });
  } catch (error) {
    console.error('Analytics dashboard error:', error);
    res.status(500).json({ error: 'Failed to fetch dashboard statistics' });
  }
});

// Get visitor analytics (auth required)
router.get('/visitors', authenticate, async (req, res) => {
  try {
    const { startDate, endDate, limit = 50, offset = 0 } = req.query;

    let whereClause = '';
    let params = [];
    
    if (startDate && endDate) {
      whereClause = 'WHERE created_at BETWEEN $1 AND $2';
      params = [startDate, endDate];
    }

    const result = await query(
      `SELECT * FROM visitor_analytics 
       ${whereClause}
       ORDER BY created_at DESC 
       LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, limit, offset]
    );

    const countResult = await query(
      `SELECT COUNT(*) as total FROM visitor_analytics ${whereClause}`,
      params
    );

    res.json({
      visitors: result.rows,
      pagination: {
        total: parseInt(countResult.rows[0].total),
        limit: parseInt(limit),
        offset: parseInt(offset)
      }
    });
  } catch (error) {
    console.error('Analytics visitors error:', error);
    res.status(500).json({ error: 'Failed to fetch visitor data' });
  }
});

// Get engagement metrics (auth required)
router.get('/engagement', authenticate, async (req, res) => {
  try {
    const daysBack = parseInt(req.query.days) || 30;
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - daysBack);

    const [
      eventBreakdown,
      hourlyActivity,
      scrollDepthStats
    ] = await Promise.all([
      // Event type breakdown
      query(
        `SELECT event_type, event_category, COUNT(*) as count 
         FROM user_events 
         WHERE timestamp >= $1 
         GROUP BY event_type, event_category 
         ORDER BY count DESC`,
        [startDate]
      ),
      // Hourly activity pattern
      query(
        `SELECT EXTRACT(hour FROM created_at) as hour, COUNT(*) as visitors
         FROM visitor_analytics 
         WHERE created_at >= $1 
         GROUP BY EXTRACT(hour FROM created_at) 
         ORDER BY hour`,
        [startDate]
      ),
      // Scroll depth statistics
      query(
        `SELECT AVG(scroll_depth) as avg_scroll, MAX(scroll_depth) as max_scroll
         FROM page_views 
         WHERE timestamp >= $1 AND scroll_depth IS NOT NULL`,
        [startDate]
      )
    ]);

    res.json({
      eventBreakdown: eventBreakdown.rows,
      hourlyActivity: hourlyActivity.rows,
      scrollDepthStats: scrollDepthStats.rows[0]
    });
  } catch (error) {
    console.error('Analytics engagement error:', error);
    res.status(500).json({ error: 'Failed to fetch engagement metrics' });
  }
});

// Get performance insights (auth required)
router.get('/performance', authenticate, async (req, res) => {
  try {
    const daysBack = parseInt(req.query.days) || 30;
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - daysBack);

    const [
      performanceStats,
      pagePerformance
    ] = await Promise.all([
      // Overall performance statistics
      query(
        `SELECT 
           AVG(load_time) as avg_load_time,
           AVG(dom_ready_time) as avg_dom_ready_time,
           AVG(first_paint_time) as avg_first_paint_time,
           AVG(largest_contentful_paint) as avg_lcp,
           AVG(cumulative_layout_shift) as avg_cls
         FROM performance_metrics 
         WHERE timestamp >= $1`,
        [startDate]
      ),
      // Performance by page
      query(
        `SELECT 
           page_path,
           AVG(load_time) as avg_load_time,
           COUNT(*) as measurements
         FROM performance_metrics 
         WHERE timestamp >= $1 
         GROUP BY page_path 
         ORDER BY avg_load_time DESC`,
        [startDate]
      )
    ]);

    res.json({
      overallStats: performanceStats.rows[0],
      pagePerformance: pagePerformance.rows
    });
  } catch (error) {
    console.error('Analytics performance error:', error);
    res.status(500).json({ error: 'Failed to fetch performance insights' });
  }
});

// Export analytics data (auth required)
router.get('/export', authenticate, async (req, res) => {
  try {
    const { startDate, endDate, format = 'json' } = req.query;

    let whereClause = '';
    let params = [];
    
    if (startDate && endDate) {
      whereClause = 'WHERE va.created_at BETWEEN $1 AND $2';
      params = [startDate, endDate];
    }

    const result = await query(
      `SELECT 
         va.*,
         array_agg(pv.*) as page_views,
         array_agg(ue.*) as events,
         array_agg(pm.*) as performance_metrics
       FROM visitor_analytics va
       LEFT JOIN page_views pv ON va.session_id = pv.session_id
       LEFT JOIN user_events ue ON va.session_id = ue.session_id
       LEFT JOIN performance_metrics pm ON va.session_id = pm.session_id
       ${whereClause}
       GROUP BY va.id
       ORDER BY va.created_at DESC`,
      params
    );

    if (format === 'csv') {
      // Convert to CSV format
      const csv = convertToCSV(result.rows);
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', 'attachment; filename="analytics-export.csv"');
      res.send(csv);
    } else {
      res.json({
        data: result.rows,
        exportedAt: new Date().toISOString(),
        totalRecords: result.rows.length
      });
    }
  } catch (error) {
    console.error('Analytics export error:', error);
    res.status(500).json({ error: 'Failed to export analytics data' });
  }
});

// Helper function to convert data to CSV
function convertToCSV(data) {
  if (!data.length) return '';
  
  const headers = Object.keys(data[0]).filter(key => typeof data[0][key] !== 'object');
  const csv = [headers.join(',')];
  
  data.forEach(row => {
    const values = headers.map(header => {
      const value = row[header];
      return typeof value === 'string' ? `"${value.replace(/"/g, '""')}"` : value;
    });
    csv.push(values.join(','));
  });
  
  return csv.join('\n');
}

export default router;