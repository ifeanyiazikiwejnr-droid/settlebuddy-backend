const express = require('express');
const { pool } = require('../db');
const { authenticate, requireRole } = require('../middleware/auth');
const router = express.Router();

// POST /api/analytics/log — log a user action
router.post('/log', authenticate, async (req, res) => {
  const { action } = req.body;
  if (!action) return res.status(400).json({ error: 'Action required' });
  try {
    await pool.query(
      'INSERT INTO activity_logs (user_id, action) VALUES ($1,$2)',
      [req.user.id, action]
    );
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/analytics/overview — full dashboard metrics for admin
router.get('/overview', authenticate, requireRole('admin'), async (req, res) => {
  try {
    // Total students
    const totalStudents = await pool.query(
      "SELECT COUNT(*) FROM users WHERE role='student'"
    );

    // Total buddies (verified)
    const totalBuddies = await pool.query(
      "SELECT COUNT(*) FROM users WHERE role='buddy' AND verified=true"
    );

    // Premium students
    const premiumStudents = await pool.query(
      "SELECT COUNT(*) FROM users WHERE role='student' AND is_premium=true"
    );

    // Active buddy matches
    const activeMatches = await pool.query(
      "SELECT COUNT(*) FROM buddy_requests WHERE status='accepted'"
    );

    // Checklist completion rate
    const checklistStats = await pool.query(`
      SELECT
        COUNT(DISTINCT user_id) as students_with_checklist,
        AVG(completion_pct) as avg_completion
      FROM (
        SELECT user_id, (COUNT(*) FILTER (WHERE completed=true) * 100.0 / 20) as completion_pct
        FROM checklist_items
        GROUP BY user_id
      ) sub
    `);

    // Weekly active users (last 8 weeks)
    const weeklyActive = await pool.query(`
      SELECT
        DATE_TRUNC('week', created_at) as week,
        COUNT(DISTINCT user_id) as active_users
      FROM activity_logs
      WHERE created_at >= NOW() - INTERVAL '8 weeks'
      GROUP BY week
      ORDER BY week ASC
    `);

    // Feature usage breakdown
    const featureUsage = await pool.query(`
      SELECT action, COUNT(*) as count
      FROM activity_logs
      WHERE created_at >= NOW() - INTERVAL '30 days'
      GROUP BY action
      ORDER BY count DESC
    `);

    // Buddy match rate (students with accepted match / total premium students)
    const matchRate = await pool.query(`
      SELECT
        COUNT(DISTINCT br.student_id) as matched_students,
        (SELECT COUNT(*) FROM users WHERE role='student' AND is_premium=true) as premium_students
      FROM buddy_requests br
      WHERE br.status='accepted'
    `);

    // New registrations last 8 weeks
    const weeklyRegistrations = await pool.query(`
      SELECT
        DATE_TRUNC('week', created_at) as week,
        COUNT(*) as new_users
      FROM users
      WHERE role='student' AND created_at >= NOW() - INTERVAL '8 weeks'
      GROUP BY week
      ORDER BY week ASC
    `);

    // Top languages spoken by buddies
    const languages = await pool.query(`
      SELECT lang, COUNT(*) as count
      FROM buddy_profiles, jsonb_array_elements_text(languages::jsonb) as lang
      WHERE verified=true
      GROUP BY lang
      ORDER BY count DESC
      LIMIT 8
    `);

    // Recent activity feed
    const recentActivity = await pool.query(`
      SELECT al.action, al.created_at, u.name, u.role
      FROM activity_logs al
      JOIN users u ON u.id = al.user_id
      ORDER BY al.created_at DESC
      LIMIT 20
    `);

    // Messages sent last 30 days
    const messageCount = await pool.query(`
      SELECT COUNT(*) FROM messages
      WHERE created_at >= NOW() - INTERVAL '30 days'
    `);

    // Documents analysed last 30 days
    const documentCount = await pool.query(`
      SELECT COUNT(*) FROM activity_logs
      WHERE action='document_analysed'
      AND created_at >= NOW() - INTERVAL '30 days'
    `);

    res.json({
      totals: {
        students: parseInt(totalStudents.rows[0].count),
        buddies: parseInt(totalBuddies.rows[0].count),
        premium: parseInt(premiumStudents.rows[0].count),
        matches: parseInt(activeMatches.rows[0].count),
        messages: parseInt(messageCount.rows[0].count),
        documents: parseInt(documentCount.rows[0].count),
      },
      checklist: {
        students_using: parseInt(checklistStats.rows[0]?.students_with_checklist || 0),
        avg_completion: parseFloat(checklistStats.rows[0]?.avg_completion || 0).toFixed(1),
      },
      match_rate: {
        matched: parseInt(matchRate.rows[0]?.matched_students || 0),
        eligible: parseInt(matchRate.rows[0]?.premium_students || 0),
      },
      weekly_active: weeklyActive.rows.map(r => ({
        week: new Date(r.week).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }),
        active_users: parseInt(r.active_users),
      })),
      weekly_registrations: weeklyRegistrations.rows.map(r => ({
        week: new Date(r.week).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }),
        new_users: parseInt(r.new_users),
      })),
      feature_usage: featureUsage.rows.map(r => ({
        action: r.action.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase()),
        count: parseInt(r.count),
      })),
      languages: languages.rows.map(r => ({
        language: r.lang,
        count: parseInt(r.count),
      })),
      recent_activity: recentActivity.rows,
    });
  } catch (err) {
    console.log('Analytics error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;