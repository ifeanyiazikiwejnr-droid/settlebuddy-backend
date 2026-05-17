const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { pool } = require('../db');
const router = express.Router();

router.post('/register', async (req, res) => {
  const { name, email, password, role } = req.body;
  if (!name || !email || !password || !role)
    return res.status(400).json({ error: 'All fields are required' });
  if (!['student','buddy','admin'].includes(role))
    return res.status(400).json({ error: 'Invalid role' });
  try {
    const exists = await pool.query('SELECT id FROM users WHERE email=$1', [email]);
    if (exists.rows.length) return res.status(409).json({ error: 'Email already registered' });
    const hashed = await bcrypt.hash(password, 10);
    const result = await pool.query(
      'INSERT INTO users (name,email,password,role) VALUES ($1,$2,$3,$4) RETURNING id,name,email,role',
      [name, email, hashed, role]
    );
    const user = result.rows[0];
    const token = jwt.sign({ id: user.id, name: user.name, role: user.role }, process.env.JWT_SECRET, { expiresIn: '7d' });
    res.status(201).json({ token, user });
  } catch (err) {
    console.log('Register error:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

router.post('/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'Email and password required' });
  try {
    const result = await pool.query('SELECT * FROM users WHERE email=$1', [email]);
    const user = result.rows[0];
    if (!user) return res.status(401).json({ error: 'Invalid credentials' });
    const valid = await bcrypt.compare(password, user.password);
    if (!valid) return res.status(401).json({ error: 'Invalid credentials' });
    const token = jwt.sign({ id: user.id, name: user.name, role: user.role }, process.env.JWT_SECRET, { expiresIn: '7d' });
    res.json({ token, user: { id: user.id, name: user.name, email: user.email, role: user.role } });
  } catch (err) {
    console.log('Login error:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/auth/register-buddy - register via invite token
router.post('/register-buddy', async (req, res) => {
  const { token, name, password, origin, university, languages, bio } = req.body;
  if (!token || !name || !password)
    return res.status(400).json({ error: 'Token, name and password are required' });

  try {
    // Validate token
    const inviteResult = await pool.query(
      'SELECT * FROM buddy_invites WHERE token=$1 AND used=false',
      [token]
    );
    if (!inviteResult.rows.length)
      return res.status(400).json({ error: 'Invalid or expired invite link' });

    const invite = inviteResult.rows[0];

    // Check email not already taken
    const exists = await pool.query('SELECT id FROM users WHERE email=$1', [invite.email]);
    if (exists.rows.length)
      return res.status(409).json({ error: 'Email already registered' });

    // Create user
    const hashed = await bcrypt.hash(password, 10);
    const userResult = await pool.query(
      'INSERT INTO users (name,email,password,role) VALUES ($1,$2,$3,$4) RETURNING id,name,email,role',
      [name, invite.email, hashed, 'buddy']
    );
    const user = userResult.rows[0];

    // Create buddy profile
    if (origin || university || languages || bio) {
      const langs = languages ? languages.split(',').map(l => l.trim()).filter(Boolean) : [];
      await pool.query(
        'INSERT INTO buddy_profiles (user_id,origin,university,languages,bio,available) VALUES ($1,$2,$3,$4,$5,$6)',
        [user.id, origin, university, langs, bio, true]
      );
    }

    // Mark invite as used
    await pool.query('UPDATE buddy_invites SET used=true WHERE token=$1', [token]);

    // Return token
    const jwtToken = jwt.sign(
      { id: user.id, name: user.name, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: '7d' }
    );
    res.status(201).json({ token: jwtToken, user });
  } catch (err) {
    console.log('Buddy register error:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/auth/forgot-password
router.post('/forgot-password', async (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ error: 'Email is required' });
  try {
    const result = await pool.query('SELECT * FROM users WHERE email=$1', [email]);
    if (!result.rows.length) {
      // Don't reveal if email exists or not
      return res.json({ message: 'If that email exists, a reset link has been generated.' });
    }
    const user = result.rows[0];
    if (user.role === 'admin') {
      return res.status(403).json({ error: 'Admin accounts cannot use password reset.' });
    }
    const crypto = require('crypto');
    const token = crypto.randomBytes(32).toString('hex');
    await pool.query(
      `INSERT INTO password_resets (email, token)
       VALUES ($1, $2)
       ON CONFLICT DO NOTHING`,
      [email, token]
    );
    let baseUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
    if (baseUrl.startsWith('http://') && !baseUrl.includes('localhost')) {
      baseUrl = baseUrl.replace('http://', 'https://');
    }
    const link = `${baseUrl}/reset-password/${token}`;
    // In production send via email — for now return the link
    res.json({
      message: 'Reset link generated successfully.',
      link,
    });
  } catch (err) {
    console.log('Forgot password error:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/auth/reset-password
router.post('/reset-password', async (req, res) => {
  const { token, password } = req.body;
  if (!token || !password) return res.status(400).json({ error: 'Token and password are required' });
  if (password.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' });
  try {
    const result = await pool.query(
      'SELECT * FROM password_resets WHERE token=$1 AND used=false',
      [token]
    );
    if (!result.rows.length) return res.status(400).json({ error: 'Invalid or expired reset link' });

    const reset = result.rows[0];
    const hashed = await bcrypt.hash(password, 10);
    await pool.query('UPDATE users SET password=$1 WHERE email=$2', [hashed, reset.email]);
    await pool.query('UPDATE password_resets SET used=true WHERE token=$1', [token]);
    res.json({ message: 'Password reset successfully' });
  } catch (err) {
    console.log('Reset password error:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;