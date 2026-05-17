const express = require('express');
const cloudinary = require('cloudinary').v2;
const multer = require('multer');
const { authenticate, requireRole } = require('../middleware/auth');
const router = express.Router();

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

console.log('Cloudinary config:', {
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY ? 'set' : 'missing',
  api_secret: process.env.CLOUDINARY_API_SECRET ? 'set' : 'missing',
});

const storage = multer.memoryStorage();
const upload = multer({ storage, limits: { fileSize: 5 * 1024 * 1024 } });

router.post('/accommodation', authenticate, requireRole('admin'), upload.single('image'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No image uploaded' });

    // Upload buffer directly to Cloudinary
    const result = await new Promise((resolve, reject) => {
      cloudinary.uploader.upload_stream(
        {
          folder: 'settlebuddy/accommodations',
          transformation: [{ width: 800, height: 500, crop: 'fill', quality: 'auto' }],
        },
        (error, result) => {
          if (error) reject(error);
          else resolve(result);
        }
      ).end(req.file.buffer);
    });

    res.json({ url: result.secure_url, public_id: result.public_id });
  } catch (err) {
    console.log('Upload error:', err.message);
    res.status(500).json({ error: 'Image upload failed: ' + err.message });
  }
});

module.exports = router;