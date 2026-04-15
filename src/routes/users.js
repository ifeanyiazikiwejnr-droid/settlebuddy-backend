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

router.delete('/:id', authenticate, requireRole('admin'), async (req, res) => {
  try {
    await pool.query('DELETE FROM users WHERE id=$1', [req.params.id]);
    res.json({ message: 'User deleted' });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;