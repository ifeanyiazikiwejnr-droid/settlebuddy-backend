const express = require('express');
const { pool } = require('../db');
const { authenticate, requireRole } = require('../middleware/auth');
const router = express.Router();

router.get('/', authenticate, async (req, res) => {
  const { language } = req.query;
  try {
    let query = `
      SELECT u.id, u.name, bp.origin, bp.university, bp.languages, bp.bio, bp.available
      FROM users u
      JOIN buddy_profiles bp ON u.id = bp.user_id
      WHERE u.role = 'buddy'
    `;
    const params = [];
    if (language) {
      params.push(`%${language.toLowerCase()}%`);
      query += ` AND LOWER(array_to_string(bp.languages, ',')) LIKE $1`;
    }
    query += ' ORDER BY bp.available DESC, u.name ASC';
    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (err) {
    console.log('Buddies error:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

router.post('/profile', authenticate, requireRole('buddy'), async (req, res) => {
  const { origin, university, languages, bio, available } = req.body;
  try {
    const exists = await pool.query('SELECT id FROM buddy_profiles WHERE user_id=$1', [req.user.id]);
    if (exists.rows.length) {
      await pool.query(
        'UPDATE buddy_profiles SET origin=$1,university=$2,languages=$3,bio=$4,available=$5 WHERE user_id=$6',
        [origin, university, languages, bio, available, req.user.id]
      );
    } else {
      await pool.query(
        'INSERT INTO buddy_profiles (user_id,origin,university,languages,bio,available) VALUES ($1,$2,$3,$4,$5,$6)',
        [req.user.id, origin, university, languages, bio, available ?? true]
      );
    }
    res.json({ message: 'Profile saved' });
  } catch (err) {
    console.log('Profile error:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

router.post('/:id/request', authenticate, requireRole('student'), async (req, res) => {
  const buddyId = parseInt(req.params.id);
  try {
    await pool.query(
      'INSERT INTO buddy_requests (student_id,buddy_id) VALUES ($1,$2) ON CONFLICT DO NOTHING',
      [req.user.id, buddyId]
    );
    res.json({ message: 'Request sent' });
  } catch (err) {
    console.log('Request error:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

router.get('/my-requests', authenticate, requireRole('buddy'), async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT br.id, br.status, br.created_at, u.name as student_name, u.email as student_email
       FROM buddy_requests br JOIN users u ON u.id = br.student_id
       WHERE br.buddy_id = $1 ORDER BY br.created_at DESC`,
      [req.user.id]
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

router.patch('/requests/:id', authenticate, requireRole('buddy'), async (req, res) => {
  const { status } = req.body;
  if (!['accepted','declined'].includes(status))
    return res.status(400).json({ error: 'Invalid status' });
  try {
    await pool.query('UPDATE buddy_requests SET status=$1 WHERE id=$2', [status, req.params.id]);
    res.json({ message: `Request ${status}` });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

router.get('/my-students', authenticate, requireRole('buddy'), async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT 
        u.id, u.name, u.email, u.created_at,
        br.status, br.created_at as request_date
       FROM buddy_requests br
       JOIN users u ON u.id = br.student_id
       WHERE br.buddy_id = $1 AND br.status = 'accepted'
       ORDER BY br.created_at DESC`,
      [req.user.id]
    );
    res.json(result.rows);
  } catch (err) {
    console.log('My students error:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

router.get('/my-profile', authenticate, requireRole('buddy'), async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT u.name, u.email, bp.origin, bp.university, bp.languages, bp.bio, bp.available
       FROM users u
       LEFT JOIN buddy_profiles bp ON u.id = bp.user_id
       WHERE u.id = $1`,
      [req.user.id]
    );
    res.json(result.rows[0] || null);
  } catch (err) {
    console.log('My profile error:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;