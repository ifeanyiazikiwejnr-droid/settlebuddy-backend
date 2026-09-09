const express = require('express');
const { pool } = require('../db');
const { authenticate, requireRole } = require('../middleware/auth');
const router = express.Router();

// Generate unique referral code
function generateCode(institution) {
  const prefix = institution
    .toUpperCase()
    .replace(/[^A-Z]/g, '')
    .slice(0, 4);
  const suffix = Math.random().toString(36).slice(2, 6).toUpperCase();
  return `${prefix}${suffix}`;
}

// ── ADMIN ROUTES ──────────────────────────────────────────

// GET all partners
router.get('/', authenticate, requireRole('admin'), async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT p.*,
        COUNT(DISTINCT u.id) as total_referred,
        COUNT(DISTINCT CASE WHEN u.is_premium THEN u.id END) as premium_converted,
        COUNT(DISTINCT CASE WHEN ci.completed = true THEN u.id END) as active_users
      FROM partners p
      LEFT JOIN users u ON u.referred_by = p.referral_code
      LEFT JOIN checklist_items ci ON ci.user_id = u.id
      GROUP BY p.id
      ORDER BY p.created_at DESC
    `);
    res.json(result.rows);
  } catch (err) {
    console.log('Partners list error:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST create partner
router.post('/', authenticate, requireRole('admin'), async (req, res) => {
  const { name, institution, email, type, commission_rate } = req.body;
  if (!name || !institution || !email) {
    return res.status(400).json({ error: 'Name, institution and email are required' });
  }
  try {
    const code = generateCode(institution);
    const result = await pool.query(
      `INSERT INTO partners (name, institution, email, type, referral_code, commission_rate)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [name, institution, email, type || 'university', code, commission_rate || 10]
    );
    res.json(result.rows[0]);
  } catch (err) {
    if (err.code === '23505') return res.status(400).json({ error: 'A partner with this email already exists' });
    res.status(500).json({ error: 'Server error' });
  }
});

// PATCH update partner
router.patch('/:id', authenticate, requireRole('admin'), async (req, res) => {
  const { name, institution, email, type, commission_rate, active } = req.body;
  try {
    const result = await pool.query(
      `UPDATE partners SET
        name=COALESCE($1,name),
        institution=COALESCE($2,institution),
        email=COALESCE($3,email),
        type=COALESCE($4,type),
        commission_rate=COALESCE($5,commission_rate),
        active=COALESCE($6,active)
       WHERE id=$7 RETURNING *`,
      [name, institution, email, type, commission_rate, active, req.params.id]
    );
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// DELETE partner
router.delete('/:id', authenticate, requireRole('admin'), async (req, res) => {
  try {
    await pool.query('DELETE FROM partners WHERE id=$1', [req.params.id]);
    res.json({ message: 'Partner deleted' });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// GET partner detailed stats
router.get('/:id/stats', authenticate, requireRole('admin'), async (req, res) => {
  try {
    const partner = await pool.query('SELECT * FROM partners WHERE id=$1', [req.params.id]);
    if (!partner.rows.length) return res.status(404).json({ error: 'Partner not found' });
    const p = partner.rows[0];

    const referred = await pool.query(
      `SELECT u.id, u.name, u.email, u.created_at, u.is_premium,
        COUNT(ci.id) FILTER (WHERE ci.completed=true) as tasks_done
       FROM users u
       LEFT JOIN checklist_items ci ON ci.user_id = u.id
       WHERE u.referred_by=$1
       GROUP BY u.id
       ORDER BY u.created_at DESC`,
      [p.referral_code]
    );

    const weeklySignups = await pool.query(
      `SELECT DATE_TRUNC('week', created_at) as week, COUNT(*) as signups
       FROM users WHERE referred_by=$1
       AND created_at >= NOW() - INTERVAL '8 weeks'
       GROUP BY week ORDER BY week ASC`,
      [p.referral_code]
    );

    const premiumCount = referred.rows.filter(r => r.is_premium).length;
    const commission = (premiumCount * 4.99 * (p.commission_rate / 100)).toFixed(2);

    res.json({
      partner: p,
      referred_students: referred.rows,
      weekly_signups: weeklySignups.rows.map(r => ({
        week: new Date(r.week).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }),
        signups: parseInt(r.signups),
      })),
      summary: {
        total_referred: referred.rows.length,
        premium_converted: premiumCount,
        conversion_rate: referred.rows.length > 0
          ? Math.round((premiumCount / referred.rows.length) * 100)
          : 0,
        commission_earned: commission,
      },
    });
  } catch (err) {
    console.log('Partner stats error:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// ── PUBLIC ROUTE ──────────────────────────────────────────

// GET validate referral code (called from registration page)
router.get('/validate/:code', async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT id, name, institution, type FROM partners WHERE referral_code=$1 AND active=true',
      [req.params.code.toUpperCase()]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Invalid referral code' });
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;