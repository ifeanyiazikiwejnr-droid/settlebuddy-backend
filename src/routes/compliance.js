const express = require('express');
const { pool } = require('../db');
const { authenticate, requireRole } = require('../middleware/auth');
const router = express.Router();

// GET compliance data for student
router.get('/', authenticate, requireRole('student'), async (req, res) => {
  try {
    const hoursResult = await pool.query(
      `SELECT * FROM work_hours WHERE user_id=$1 ORDER BY week_start DESC LIMIT 52`,
      [req.user.id]
    );
    const profileResult = await pool.query(
      `SELECT * FROM compliance_profiles WHERE user_id=$1`,
      [req.user.id]
    );
    res.json({
      hours: hoursResult.rows,
      profile: profileResult.rows[0] || null,
    });
  } catch (err) {
    console.log('Compliance get error:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST or update compliance profile
router.post('/profile', authenticate, requireRole('student'), async (req, res) => {
  const { course_start, course_end, term_dates, visa_expiry, university, course_name } = req.body;
  try {
    await pool.query(
      `INSERT INTO compliance_profiles (user_id, course_start, course_end, term_dates, visa_expiry, university, course_name)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT (user_id) DO UPDATE SET
         course_start=$2, course_end=$3, term_dates=$4,
         visa_expiry=$5, university=$6, course_name=$7`,
      [req.user.id, course_start, course_end, JSON.stringify(term_dates), visa_expiry, university, course_name]
    );
    res.json({ message: 'Profile saved' });
  } catch (err) {
    console.log('Compliance profile error:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST log work hours for a week
router.post('/hours', authenticate, requireRole('student'), async (req, res) => {
  const { week_start, hours_worked, is_holiday } = req.body;
  if (!week_start || hours_worked === undefined) {
    return res.status(400).json({ error: 'week_start and hours_worked are required' });
  }
  try {
    await pool.query(
      `INSERT INTO work_hours (user_id, week_start, hours_worked, is_holiday)
       VALUES ($1,$2,$3,$4)
       ON CONFLICT (user_id, week_start) DO UPDATE SET
         hours_worked=$3, is_holiday=$4`,
      [req.user.id, week_start, hours_worked, is_holiday || false]
    );
    res.json({ message: 'Hours logged' });
  } catch (err) {
    console.log('Hours log error:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// DELETE a week's hours
router.delete('/hours/:week_start', authenticate, requireRole('student'), async (req, res) => {
  try {
    await pool.query(
      'DELETE FROM work_hours WHERE user_id=$1 AND week_start=$2',
      [req.user.id, req.params.week_start]
    );
    res.json({ message: 'Deleted' });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;