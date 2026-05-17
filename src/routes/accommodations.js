const express = require('express');
const { pool } = require('../db');
const { authenticate, requireRole } = require('../middleware/auth');
const router = express.Router();

router.get('/', authenticate, async (req, res) => {
  try {
    const { city } = req.query;
    let query = 'SELECT * FROM accommodations';
    const params = [];
    if (city) {
      params.push(`%${city}%`);
      query += ' WHERE LOWER(location) LIKE LOWER($1)';
    }
    query += ' ORDER BY created_at DESC';
    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/accommodations/cities - get unique cities
router.get('/cities', authenticate, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT DISTINCT SPLIT_PART(location, ',', 1) as city, COUNT(*) as count
       FROM accommodations
       GROUP BY city
       ORDER BY city ASC`
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

router.post('/', authenticate, requireRole('admin'), async (req, res) => {
  const { title, location, price, type, description, status, image_url } = req.body;
  if (!title || !location || !price)
    return res.status(400).json({ error: 'Title, location and price are required' });
  try {
    const result = await pool.query(
      'INSERT INTO accommodations (title,location,price,type,description,status,image_url,uploaded_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *',
      [title, location, price, type, description, status || 'available', image_url || null, req.user.id]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// GET single accommodation with all images
router.get('/:id', authenticate, async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM accommodations WHERE id=$1', [req.params.id]);
    if (!result.rows.length) return res.status(404).json({ error: 'Not found' });
    const images = await pool.query(
      'SELECT * FROM accommodation_images WHERE accommodation_id=$1 ORDER BY created_at ASC',
      [req.params.id]
    );
    res.json({ ...result.rows[0], images: images.rows });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// POST add image to accommodation
router.post('/:id/images', authenticate, requireRole('admin'), async (req, res) => {
  const { url } = req.body;
  if (!url) return res.status(400).json({ error: 'URL required' });
  try {
    const result = await pool.query(
      'INSERT INTO accommodation_images (accommodation_id, url) VALUES ($1,$2) RETURNING *',
      [req.params.id, url]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// DELETE image
router.delete('/:id/images/:imageId', authenticate, requireRole('admin'), async (req, res) => {
  try {
    await pool.query('DELETE FROM accommodation_images WHERE id=$1', [req.params.imageId]);
    res.json({ message: 'Image deleted' });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// PATCH update accommodation details
router.patch('/:id', authenticate, requireRole('admin'), async (req, res) => {
  const { title, location, price, type, description, status, detailed_description } = req.body;
  try {
    const result = await pool.query(
      `UPDATE accommodations SET
        title=COALESCE($1,title),
        location=COALESCE($2,location),
        price=COALESCE($3,price),
        type=COALESCE($4,type),
        description=COALESCE($5,description),
        status=COALESCE($6,status),
        detailed_description=COALESCE($7,detailed_description)
       WHERE id=$8 RETURNING *`,
      [title, location, price, type, description, status, detailed_description, req.params.id]
    );
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

router.delete('/:id', authenticate, requireRole('admin'), async (req, res) => {
  try {
    await pool.query('DELETE FROM accommodations WHERE id=$1', [req.params.id]);
    res.json({ message: 'Deleted' });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;