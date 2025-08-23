import express from 'express';
import { OAuth2Client } from 'google-auth-library';
import { body, validationResult } from 'express-validator';
import { query } from '../config/database.js';
import { generateToken, authenticate } from '../middleware/auth.js';
import passport from '../config/passport.js';

const router = express.Router();

// Initialize Google OAuth client
const googleClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

// Helper function to verify Google ID token
async function verifyGoogleToken(idToken) {
  try {
    const ticket = await googleClient.verifyIdToken({
      idToken,
      audience: process.env.GOOGLE_CLIENT_ID,
    });
    return ticket.getPayload();
  } catch (error) {
    console.error('Google token verification failed:', error);
    return null;
  }
}

// Helper function to check if email is authorized admin (from database)
async function isAuthorizedAdmin(email) {
  try {
    const result = await query(
      'SELECT id FROM admin_users WHERE email = $1 AND is_active = TRUE',
      [email.toLowerCase()]
    );
    return result.rows.length > 0;
  } catch (error) {
    console.error('Error checking admin authorization:', error);
    return false;
  }
}

// Helper function to create or update admin user
async function createOrUpdateAdmin(googlePayload) {
  const { email, sub: googleId, name, picture } = googlePayload;
  
  // Check if user exists
  let result = await query(
    'SELECT * FROM admin_users WHERE email = $1',
    [email]
  );

  let user;
  if (result.rows.length > 0) {
    // Update existing user
    user = result.rows[0];
    await query(
      `UPDATE admin_users 
       SET google_id = $1, avatar_url = $2, last_login = NOW(), provider = 'google'
       WHERE id = $3`,
      [googleId, picture, user.id]
    );
    console.log(`✅ Updated existing admin user: ${email}`);
  } else {
    // Create new admin user
    const insertResult = await query(
      `INSERT INTO admin_users (email, google_id, avatar_url, role, provider, is_active, created_at, last_login)
       VALUES ($1, $2, $3, 'admin', 'google', true, NOW(), NOW())
       RETURNING *`,
      [email, googleId, picture]
    );
    user = insertResult.rows[0];
    console.log(`✅ Created new admin user: ${email}`);
  }

  return user;
}

// Google OAuth for web (redirects to frontend)
router.get('/google', (req, res, next) => {
  if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) {
    return res.status(501).json({ error: 'Google OAuth not configured' });
  }
  passport.authenticate('google', { 
    scope: ['profile', 'email'],
    prompt: 'select_account'
  })(req, res, next);
});

// Google OAuth callback (for web)
router.get('/google/callback', (req, res, next) => {
  if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) {
    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:8080';
    return res.redirect(`${frontendUrl}/admin?error=oauth_not_configured`);
  }
  
  passport.authenticate('google', { 
    failureRedirect: `${process.env.FRONTEND_URL || 'http://localhost:8080'}/admin/login?error=auth_failed`,
    session: false 
  })(req, res, (err) => {
    if (err) {
      console.error('Google OAuth callback error:', err);
      const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:8080';
      return res.redirect(`${frontendUrl}/admin/login?error=auth_failed`);
    }
    
    // Generate JWT token for the authenticated user
    const token = generateToken({
      userId: req.user.id,
      email: req.user.email,
      role: req.user.role
    });

    // Redirect to frontend dashboard with token
    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:8080';
    res.redirect(`${frontendUrl}/admin/dashboard?token=${token}&email=${encodeURIComponent(req.user.email)}`);
  });
});

// Google OAuth for API (Postman-friendly)
router.post('/google/token', [
  body('id_token').notEmpty().withMessage('Google ID token is required')
], async (req, res) => {
  try {
    // Check validation errors
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ 
        error: 'Validation failed', 
        details: errors.array() 
      });
    }

    const { id_token } = req.body;

    // Verify Google ID token
    const googlePayload = await verifyGoogleToken(id_token);
    if (!googlePayload) {
      return res.status(401).json({ error: 'Invalid Google ID token' });
    }

    const { email } = googlePayload;
    console.log(`🔐 Google ID token auth attempt for: ${email}`);

    // Check if email is authorized
    if (!(await isAuthorizedAdmin(email))) {
      console.log(`❌ Access denied for: ${email} (not in admin list)`);
      return res.status(403).json({ 
        error: 'Access denied. You are not authorized to access the admin panel.' 
      });
    }

    // Create or update admin user
    const user = await createOrUpdateAdmin(googlePayload);

    // Generate JWT token
    const token = generateToken({
      userId: user.id,
      email: user.email,
      role: user.role || 'admin'
    });

    res.json({
      message: 'Login successful',
      token,
      user: {
        id: user.id,
        email: user.email,
        role: user.role || 'admin',
        provider: 'google',
        avatar_url: user.avatar_url
      }
    });

  } catch (error) {
    console.error('Google token login error:', error);
    res.status(500).json({ error: 'Authentication failed' });
  }
});

// Get current user info
router.get('/me', authenticate, async (req, res) => {
  try {
    const result = await query(
      'SELECT id, email, role, provider, avatar_url, created_at, last_login FROM admin_users WHERE id = $1',
      [req.user.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json({ user: result.rows[0] });
  } catch (error) {
    console.error('Get user error:', error);
    res.status(500).json({ error: 'Failed to get user info' });
  }
});

// Verify token endpoint
router.get('/verify', authenticate, (req, res) => {
  res.json({ 
    valid: true, 
    user: {
      id: req.user.id,
      email: req.user.email,
      role: req.user.role || 'admin',
      provider: req.user.provider || 'google'
    }
  });
});

// Get admin emails from environment (for reference)
router.get('/admin/list', authenticate, (req, res) => {
  const adminEmails = (process.env.ADMIN_EMAILS || 'mrityunjoydey1999@gmail.com')
    .split(',')
    .map(e => e.trim());
    
  res.json({ 
    message: 'Admin emails are managed via ADMIN_EMAILS environment variable',
    current_admins: adminEmails,
    note: 'To add/remove admins, update the ADMIN_EMAILS environment variable and restart the server'
  });
});

// Google OAuth status check
router.get('/google/status', (req, res) => {
  res.json({
    available: !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET),
    clientId: process.env.GOOGLE_CLIENT_ID ? 'configured' : 'missing',
    callbackUrl: process.env.GOOGLE_CALLBACK_URL || "http://localhost:8000/api/auth/google/callback"
  });
});

// Logout endpoint (client-side token removal)
router.post('/logout', authenticate, (req, res) => {
  res.json({ message: 'Logout successful. Please remove token from client.' });
});

export default router;