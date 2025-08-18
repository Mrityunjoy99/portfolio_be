import express from 'express';
import { query } from '../config/database.js';
import { getProfile } from '../config/portfolio-data.js';

const router = express.Router();

// Download resume endpoint (public, no auth required)
router.get('/resume', async (req, res) => {
  try {
    // Get the profile with resume_url using new data access layer
    const profile = await getProfile();
    
    if (!profile || !profile.resume_url) {
      return res.status(404).json({ error: 'Resume not found' });
    }
    
    const resumeUrl = profile.resume_url;
    
    // Extract filename from the resume URL (e.g., "/uploads/filename.pdf" -> "filename.pdf")
    const filename = resumeUrl.split('/').pop();
    if (!filename) {
      return res.status(404).json({ error: 'Invalid resume file path' });
    }
    
    // Get the file data from uploads table
    const fileResult = await query(
      'SELECT filename, original_name, mime_type, file_data FROM uploads WHERE filename = $1',
      [filename]
    );
    
    if (fileResult.rows.length === 0) {
      return res.status(404).json({ error: 'Resume file not found' });
    }
    
    const file = fileResult.rows[0];
    
    // Set appropriate headers for download
    res.set({
      'Content-Type': file.mime_type,
      'Content-Disposition': `attachment; filename="${file.original_name}"`,
      'Cache-Control': 'public, max-age=3600', // Cache for 1 hour
      'Content-Length': file.file_data.length.toString(),
      'X-Content-Type-Options': 'nosniff',
    });
    
    // Send file data as Buffer
    res.end(Buffer.from(file.file_data));
  } catch (error) {
    console.error('Resume download error:', error);
    res.status(500).json({ error: 'Failed to download resume' });
  }
});

// Download profile image endpoint (public, no auth required)
router.get('/profile-img', async (req, res) => {
  try {
    // Get the profile with profile_image_url using new data access layer
    const profile = await getProfile();
    
    if (!profile || !profile.profile_image_url) {
      return res.status(404).json({ error: 'Profile image not found' });
    }
    
    const profileImageUrl = profile.profile_image_url;
    
    // Extract filename from the profile image URL
    const filename = profileImageUrl.split('/').pop();
    if (!filename) {
      return res.status(404).json({ error: 'Invalid profile image file path' });
    }
    
    // Get the file data from uploads table
    const fileResult = await query(
      'SELECT filename, original_name, mime_type, file_data FROM uploads WHERE filename = $1',
      [filename]
    );
    
    if (fileResult.rows.length === 0) {
      return res.status(404).json({ error: 'Profile image file not found' });
    }
    
    const file = fileResult.rows[0];
    
    // Set appropriate headers for inline display (not download)
    res.set({
      'Content-Type': file.mime_type,
      'Content-Disposition': `inline; filename="${file.original_name}"`,
      'Cache-Control': 'public, max-age=86400', // Cache for 24 hours (longer since images change less frequently)
      'Content-Length': file.file_data.length.toString(),
      'X-Content-Type-Options': 'nosniff',
    });
    
    // Send file data as Buffer
    res.end(Buffer.from(file.file_data));
  } catch (error) {
    console.error('Profile image download error:', error);
    res.status(500).json({ error: 'Failed to load profile image' });
  }
});

export default router;