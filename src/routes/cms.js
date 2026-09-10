const express = require('express');
const { pool } = require('../db');
const { authenticate, requireRole } = require('../middleware/auth');
const router = express.Router();

// ── PUBLIC ──────────────────────────────────────────────────

// GET /api/cms/:code — get all active content for an institution
router.get('/:code', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT * FROM institution_content
       WHERE referral_code=$1 AND active=true
       ORDER BY content_type, display_order ASC`,
      [req.params.code.toUpperCase()]
    );
    // Group by content_type
    const grouped = result.rows.reduce((acc, item) => {
      if (!acc[item.content_type]) acc[item.content_type] = [];
      acc[item.content_type].push(item);
      return acc;
    }, {});
    res.json(grouped);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/cms/context/:userId — get AI context string for a user
router.get('/context/:userId', authenticate, async (req, res) => {
  try {
    const userRes = await pool.query(
      'SELECT referred_by, name FROM users WHERE id=$1',
      [req.params.userId]
    );
    const user = userRes.rows[0];
    if (!user?.referred_by) return res.json({ context: null });

    const partnerRes = await pool.query(
      'SELECT name, institution FROM partners WHERE referral_code=$1',
      [user.referred_by]
    );
    const partner = partnerRes.rows[0];

    const contentRes = await pool.query(
      `SELECT * FROM institution_content
       WHERE referral_code=$1 AND active=true
       ORDER BY content_type, display_order ASC`,
      [user.referred_by]
    );

    if (!contentRes.rows.length) return res.json({ context: null });

    // Build context string for AI
    const grouped = contentRes.rows.reduce((acc, item) => {
      if (!acc[item.content_type]) acc[item.content_type] = [];
      acc[item.content_type].push(item);
      return acc;
    }, {});

    let context = `\nUNIVERSITY CONTEXT FOR THIS STUDENT:\n`;
    if (partner) context += `Institution: ${partner.institution}\n`;

    if (grouped.contact) {
      context += `\nINTERNATIONAL OFFICE:\n`;
      grouped.contact.forEach(c => {
        context += `- ${c.title}`;
        if (c.description) context += `: ${c.description}`;
        if (c.phone) context += ` | Tel: ${c.phone}`;
        if (c.link) context += ` | ${c.link}`;
        context += '\n';
      });
    }
    if (grouped.gp) {
      context += `\nCAMPUS/LOCAL GPS:\n`;
      grouped.gp.forEach(c => {
        context += `- ${c.title}`;
        if (c.address) context += `, ${c.address}`;
        if (c.phone) context += ` | Tel: ${c.phone}`;
        context += '\n';
      });
    }
    if (grouped.event) {
      context += `\nUPCOMING EVENTS:\n`;
      grouped.event.forEach(c => {
        context += `- ${c.title}`;
        if (c.description) context += `: ${c.description}`;
        context += '\n';
      });
    }
    if (grouped.service) {
      context += `\nLOCAL SERVICES:\n`;
      grouped.service.forEach(c => {
        context += `- ${c.title}`;
        if (c.description) context += `: ${c.description}`;
        if (c.address) context += ` (${c.address})`;
        context += '\n';
      });
    }
    if (grouped.accommodation) {
      context += `\nUNIVERSITY ACCOMMODATION:\n`;
      grouped.accommodation.forEach(c => {
        context += `- ${c.title}`;
        if (c.description) context += `: ${c.description}`;
        if (c.link) context += ` | ${c.link}`;
        context += '\n';
      });
    }

    context += `\nUse this information to give personalised answers specific to this student's institution. Always prioritise this information over generic answers.\n`;

    res.json({ context, institution: partner?.institution, referral_code: user.referred_by });
  } catch (err) {
    console.log('CMS context error:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// ── ADMIN ──────────────────────────────────────────────────

// GET all content for a code (admin)
router.get('/admin/:code', authenticate, requireRole('admin'), async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT * FROM institution_content
       WHERE referral_code=$1
       ORDER BY content_type, display_order ASC`,
      [req.params.code.toUpperCase()]
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// POST create content item
router.post('/', authenticate, requireRole('admin'), async (req, res) => {
  const { referral_code, content_type, title, description, link, address, phone, display_order } = req.body;
  if (!referral_code || !content_type || !title) {
    return res.status(400).json({ error: 'referral_code, content_type and title are required' });
  }
  try {
    const result = await pool.query(
      `INSERT INTO institution_content
       (referral_code, content_type, title, description, link, address, phone, display_order)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [referral_code.toUpperCase(), content_type, title, description, link, address, phone, display_order || 0]
    );
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// PATCH update content item
router.patch('/:id', authenticate, requireRole('admin'), async (req, res) => {
  const { title, description, link, address, phone, active, display_order } = req.body;
  try {
    const result = await pool.query(
      `UPDATE institution_content SET
        title=COALESCE($1,title),
        description=COALESCE($2,description),
        link=COALESCE($3,link),
        address=COALESCE($4,address),
        phone=COALESCE($5,phone),
        active=COALESCE($6,active),
        display_order=COALESCE($7,display_order)
       WHERE id=$8 RETURNING *`,
      [title, description, link, address, phone, active, display_order, req.params.id]
    );
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// DELETE content item
router.delete('/:id', authenticate, requireRole('admin'), async (req, res) => {
  try {
    await pool.query('DELETE FROM institution_content WHERE id=$1', [req.params.id]);
    res.json({ message: 'Deleted' });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;