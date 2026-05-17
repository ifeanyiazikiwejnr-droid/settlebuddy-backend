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

router.delete('/:id', authenticate, requireRole('admin'), async (req, res) => {
  try {
    await pool.query('DELETE FROM accommodations WHERE id=$1', [req.params.id]);
    res.json({ message: 'Deleted' });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;