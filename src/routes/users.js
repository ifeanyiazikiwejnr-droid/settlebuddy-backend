const express = require('express');
const { pool } = require('../db');
const { authenticate, requireRole } = require('../middleware/auth');
const router = express.Router();

router.get('/', authenticate, requireRole('admin'), async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT 
        u.id, u.name, u.email, u.role, u.created_at,
        bp.origin, bp.university, bp.languages, bp.available
      FROM users u
      LEFT JOIN buddy_profiles bp ON u.id = bp.user_id
      ORDER BY u.role, u.created_at DESC
    `);

    const students = result.rows.filter(u => u.role === 'student');
    const buddies = result.rows.filter(u => u.role === 'buddy');
    const admins = result.rows.filter(u => u.role === 'admin');

    res.json({ students, buddies, admins });
  } catch (err) {
    console.log('Users error:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// GET pending buddies
router.get('/pending-buddies', authenticate, requireRole('admin'), async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT u.id, u.name, u.email, u.created_at,
        bp.origin, bp.university, bp.languages, bp.bio, bp.available
       FROM users u
       LEFT JOIN buddy_profiles bp ON bp.user_id = u.id
       WHERE u.role = 'buddy' AND u.verified = false
       ORDER BY u.created_at DESC`
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// PATCH verify buddy
router.patch('/:id/verify', authenticate, requireRole('admin'), async (req, res) => {
  try {
    await pool.query('UPDATE users SET verified=true WHERE id=$1', [req.params.id]);
    res.json({ message: 'Buddy verified' });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// PATCH reject buddy
router.patch('/:id/reject', authenticate, requireRole('admin'), async (req, res) => {
  try {
    await pool.query('DELETE FROM users WHERE id=$1 AND role=$2', [req.params.id, 'buddy']);
    res.json({ message: 'Buddy rejected' });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

router.delete('/:id', authenticate, requireRole('admin'), async (req, res) => {
  try {
    await pool.query('DELETE FROM users WHERE id=$1', [req.params.id]);
    res.json({ message: 'User deleted' });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;