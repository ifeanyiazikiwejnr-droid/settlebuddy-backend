const express = require('express');
const crypto = require('crypto');
const { pool } = require('../db');
const { authenticate, requireRole } = require('../middleware/auth');
const router = express.Router();

// POST /api/invites - admin sends invite
router.post('/', authenticate, requireRole('admin'), async (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ error: 'Email is required' });

  try {
    // Check if already a user
    const existing = await pool.query('SELECT id FROM users WHERE email=$1', [email]);
    if (existing.rows.length)
      return res.status(409).json({ error: 'A user with this email already exists' });

    // Generate unique token
    const token = crypto.randomBytes(32).toString('hex');

    // Save invite (replace if already invited)
    await pool.query(
      `INSERT INTO buddy_invites (email, token, created_by)
       VALUES ($1, $2, $3)
       ON CONFLICT (email) DO UPDATE SET token=$2, used=false, created_at=NOW()`,
      [email, token, req.user.id]
    );

    // Build the invite link
    const link = `http://localhost:3000/register-buddy/${token}`;

    // In production you would send an email here
    // For now we return the link so admin can share it manually
    res.json({
      message: 'Invite created successfully',
      link,
      email,
    });
  } catch (err) {
    console.log('Invite error:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/invites/:token - validate a token
router.get('/:token', async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM buddy_invites WHERE token=$1 AND used=false',
      [req.params.token]
    );
    if (!result.rows.length)
      return res.status(404).json({ error: 'Invalid or expired invite link' });
    res.json({ email: result.rows[0].email, valid: true });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/invites - list all invites (admin)
router.get('/', authenticate, requireRole('admin'), async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT bi.id, bi.email, bi.used, bi.created_at, u.name as invited_by
       FROM buddy_invites bi
       LEFT JOIN users u ON u.id = bi.created_by
       ORDER BY bi.created_at DESC`
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;