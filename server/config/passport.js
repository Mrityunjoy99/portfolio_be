import passport from 'passport';
import { Strategy as GoogleStrategy } from 'passport-google-oauth20';
import { Strategy as JwtStrategy, ExtractJwt } from 'passport-jwt';
import { query } from './database.js';

// Google OAuth Strategy (only if credentials are provided)
if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) {
  passport.use(new GoogleStrategy({
    clientID: process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    callbackURL: process.env.GOOGLE_CALLBACK_URL || "http://localhost:8000/api/auth/google/callback"
  }, async (accessToken, refreshToken, profile, done) => {
  try {
    const email = profile.emails[0].value;
    const googleId = profile.id;
    const name = profile.displayName;
    const avatarUrl = profile.photos[0]?.value;

    console.log(`🔐 Google OAuth attempt for: ${email}`);

    // Check if user exists and has admin role
    let result = await query(
      'SELECT * FROM admin_users WHERE email = $1 AND is_active = true',
      [email]
    );

    let user;
    if (result.rows.length > 0) {
      // Update existing user with Google info
      user = result.rows[0];
      await query(
        `UPDATE admin_users 
         SET google_id = $1, avatar_url = $2, last_login = NOW(), provider = 'google'
         WHERE id = $3`,
        [googleId, avatarUrl, user.id]
      );
      console.log(`✅ Updated existing admin user: ${email}`);
    } else {
      // Check if this email should have admin access
      const allowedAdmins = [
        'mrityunjoydey1999@gmail.com'
        // Add more admin emails here as needed
      ];

      if (!allowedAdmins.includes(email)) {
        console.log(`❌ Access denied for: ${email} (not in admin list)`);
        return done(null, false, { message: 'Access denied. You are not authorized to access the admin panel.' });
      }

      // Create new admin user
      const insertResult = await query(
        `INSERT INTO admin_users (email, google_id, avatar_url, role, provider, is_active, created_at, last_login)
         VALUES ($1, $2, $3, 'admin', 'google', true, NOW(), NOW())
         RETURNING *`,
        [email, googleId, avatarUrl]
      );
      user = insertResult.rows[0];
      console.log(`✅ Created new admin user: ${email}`);
    }

    return done(null, {
      id: user.id,
      email: user.email,
      role: user.role,
      googleId: user.google_id,
      avatarUrl: user.avatar_url,
      provider: user.provider
    });
    } catch (error) {
      console.error('Google OAuth error:', error);
      return done(error, null);
    }
  }));
  
  console.log('✅ Google OAuth strategy configured');
} else {
  console.log('⚠️  Google OAuth not configured (missing GOOGLE_CLIENT_ID or GOOGLE_CLIENT_SECRET)');
}

// JWT Strategy for API authentication
passport.use(new JwtStrategy({
  jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
  secretOrKey: process.env.JWT_SECRET || 'your-secret-key'
}, async (jwtPayload, done) => {
  try {
    const result = await query(
      'SELECT id, email, role, provider, is_active FROM admin_users WHERE id = $1 AND is_active = true',
      [jwtPayload.userId]
    );

    if (result.rows.length > 0) {
      return done(null, result.rows[0]);
    } else {
      return done(null, false);
    }
  } catch (error) {
    return done(error, false);
  }
}));

// Serialize user for session
passport.serializeUser((user, done) => {
  done(null, user.id);
});

// Deserialize user from session
passport.deserializeUser(async (id, done) => {
  try {
    const result = await query(
      'SELECT id, email, role, provider, avatar_url FROM admin_users WHERE id = $1 AND is_active = true',
      [id]
    );

    if (result.rows.length > 0) {
      done(null, result.rows[0]);
    } else {
      done(null, false);
    }
  } catch (error) {
    done(error, null);
  }
});

export default passport;
