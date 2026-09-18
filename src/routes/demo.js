const express = require('express');
const { pool } = require('../db');
const bcrypt = require('bcryptjs');
const { authenticate, requireRole } = require('../middleware/auth');
const router = express.Router();

// POST /api/demo/request — create a demo account
router.post('/request', async (req, res) => {
  const { name, institution, role, email } = req.body;
  if (!name || !institution || !email) {
    return res.status(400).json({ error: 'Name, institution and email are required' });
  }

  try {
    // Check if demo already exists for this email
    const existing = await pool.query(
      'SELECT id, demo_expires_at FROM users WHERE email=$1 AND is_demo=true',
      [email]
    );
    if (existing.rows.length > 0) {
      const expires = new Date(existing.rows[0].demo_expires_at);
      if (expires > new Date()) {
        return res.status(400).json({
          error: 'A demo account already exists for this email. Check your email for login details.',
        });
      }
      // Expired demo — delete and recreate
      await pool.query('DELETE FROM users WHERE id=$1', [existing.rows[0].id]);
    }

    // Create demo account
    const demoPassword = `Demo${Math.random().toString(36).slice(2, 8)}!`;
    const hashed = await bcrypt.hash(demoPassword, 10);
    const expiresAt = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000); // 14 days

        const userRes = await pool.query(
      `INSERT INTO users (name, email, password, role, verified, is_demo, demo_expires_at, institution, is_premium)
       VALUES ($1, $2, $3, 'institution', true, true, $4, $5, true)
       ON CONFLICT (email) DO UPDATE SET
         password=$3, is_demo=true, demo_expires_at=$4,
         institution=$5, verified=true, is_premium=true, role='institution'
       RETURNING id, name, email, role`,
      [name, email, hashed, expiresAt, institution]
    );

    const userId = userRes.rows[0].id;

    // Seed demo data
    await seedDemoData(userId, institution);

    // Log demo request
    await pool.query(
      'INSERT INTO demo_requests (name, institution, role, email) VALUES ($1,$2,$3,$4)',
      [name, institution, role || 'International Student Officer', email]
    );

    res.json({
      message: 'Demo account created successfully',
      credentials: {
        email,
        password: demoPassword,
        expires: expiresAt,
      },
    });
  } catch (err) {
    console.log('Demo creation error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Seed realistic demo data
async function seedDemoData(adminId, institution) {
  const hashed = await bcrypt.hash('DemoStudent123!', 10);

  // Create 5 demo buddies
  const buddyNames = [
    ['Amara Okafor', 'amara.demo@settlebuddy.uk', 'Nigeria', ['Yoruba', 'English']],
    ['Wei Zhang', 'wei.demo@settlebuddy.uk', 'China', ['Mandarin', 'English']],
    ['Priya Sharma', 'priya.demo@settlebuddy.uk', 'India', ['Hindi', 'English']],
    ['Fatima Al-Hassan', 'fatima.demo@settlebuddy.uk', 'UAE', ['Arabic', 'English']],
    ['Carlos Mendez', 'carlos.demo@settlebuddy.uk', 'Colombia', ['Spanish', 'English']],
  ];

  const buddyIds = [];
  for (const [name, email, origin, languages] of buddyNames) {
    try {
      const b = await pool.query(
        `INSERT INTO users (name, email, password, role, verified, is_demo, demo_expires_at)
         VALUES ($1,$2,$3,'buddy',true,true,NOW() + INTERVAL '14 days')
         ON CONFLICT (email) DO UPDATE SET name=$1 RETURNING id`,
        [name, email, hashed]
      );
      const buddyId = b.rows[0].id;
      buddyIds.push(buddyId);
      await pool.query(
        `INSERT INTO buddy_profiles (user_id, origin, university, languages, bio, available, verified)
         VALUES ($1,$2,$3,$4,$5,true,true)
         ON CONFLICT (user_id) DO UPDATE SET origin=$2, university=$3, languages=$4, bio=$5`,
        [buddyId, origin, institution,
          JSON.stringify(languages),
          `Hi! I'm a ${origin} student who settled into UK life and I'm here to help you do the same. I can guide you through banking, NHS registration, transport and more.`]
      );
    } catch {}
  }

  // Create 15 demo students
  const studentNames = [
    ['Emeka Nwosu', 'emeka.demo@settlebuddy.uk'],
    ['Mei Lin', 'mei.demo@settlebuddy.uk'],
    ['Rahul Gupta', 'rahul.demo@settlebuddy.uk'],
    ['Aisha Mohammed', 'aisha.demo@settlebuddy.uk'],
    ['Sofia Rodriguez', 'sofia.demo@settlebuddy.uk'],
    ['Kwame Asante', 'kwame.demo@settlebuddy.uk'],
    ['Yuki Tanaka', 'yuki.demo@settlebuddy.uk'],
    ['Omar Abdullah', 'omar.demo@settlebuddy.uk'],
    ['Chioma Eze', 'chioma.demo@settlebuddy.uk'],
    ['Li Wei', 'liwei.demo@settlebuddy.uk'],
    ['Ananya Patel', 'ananya.demo@settlebuddy.uk'],
    ['Mohammed Al-Farsi', 'mohammed.demo@settlebuddy.uk'],
    ['Grace Mensah', 'grace.demo@settlebuddy.uk'],
    ['Hiroshi Yamamoto', 'hiroshi.demo@settlebuddy.uk'],
    ['Fatou Diallo', 'fatou.demo@settlebuddy.uk'],
  ];

  const studentIds = [];
  for (const [name, email] of studentNames) {
    try {
      const s = await pool.query(
        `INSERT INTO users (name, email, password, role, verified, is_premium, is_demo, demo_expires_at)
         VALUES ($1,$2,$3,'student',true,$4,true,NOW() + INTERVAL '14 days')
         ON CONFLICT (email) DO UPDATE SET name=$1 RETURNING id`,
        [name, email, hashed, Math.random() > 0.5]
      );
      studentIds.push(s.rows[0].id);
    } catch {}
  }

  // Create buddy requests and matches for first 5 students
  for (let i = 0; i < Math.min(5, studentIds.length, buddyIds.length); i++) {
    try {
      const reqRes = await pool.query(
        `INSERT INTO buddy_requests (student_id, buddy_id, status, created_at)
         VALUES ($1,$2,'accepted', NOW() - INTERVAL '${i + 1} days')
         ON CONFLICT DO NOTHING RETURNING id`,
        [studentIds[i], buddyIds[i]]
      );
      if (reqRes.rows.length > 0) {
        // Create conversation for matched pairs
        const convRes = await pool.query(
          `INSERT INTO conversations (student_id, buddy_id, created_at)
           VALUES ($1,$2, NOW() - INTERVAL '${i + 1} days')
           ON CONFLICT DO NOTHING RETURNING id`,
          [studentIds[i], buddyIds[i]]
        );
        if (convRes.rows.length > 0) {
          const convId = convRes.rows[0].id;
          // Seed a few messages
          const msgs = [
            { sender: studentIds[i], content: 'Hi! I just arrived in the UK. Can you help me with NHS registration?' },
            { sender: buddyIds[i], content: 'Welcome! Yes of course. First thing is to find your nearest GP surgery and register online.' },
            { sender: studentIds[i], content: 'Thank you so much! Do I need my BRP card first?' },
            { sender: buddyIds[i], content: 'Yes, bring your BRP, passport and proof of address. Most GPs are very helpful with new students.' },
          ];
          for (const msg of msgs) {
            try {
              await pool.query(
                `INSERT INTO messages (conversation_id, sender_id, content, created_at)
                 VALUES ($1,$2,$3, NOW() - INTERVAL '${Math.floor(Math.random() * 12)} hours')`,
                [convId, msg.sender, msg.content]
              );
            } catch {}
          }
        }
      }
    } catch {}
  }

  // Seed checklist completions for students
  const checklistKeys = ['passport', 'flight', 'sim_card', 'university_register', 'bank_account', 'nhs_register'];
  for (const studentId of studentIds.slice(0, 8)) {
    const keysToComplete = checklistKeys.slice(0, Math.floor(Math.random() * 6) + 1);
    for (const key of keysToComplete) {
      try {
        await pool.query(
          `INSERT INTO checklist_items (user_id, task_key, completed, completed_at)
           VALUES ($1,$2,true,NOW() - INTERVAL '${Math.floor(Math.random() * 7)} days')
           ON CONFLICT (user_id, task_key) DO NOTHING`,
          [studentId, key]
        );
      } catch {}
    }
  }

  console.log(`Demo data seeded for institution: ${institution}`);
}

// GET /api/demo/status — check demo account status
router.get('/status', authenticate, async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT is_demo, demo_expires_at, institution FROM users WHERE id=$1',
      [req.user.id]
    );
    const user = result.rows[0];
    if (!user?.is_demo) return res.json({ is_demo: false });
    const daysLeft = Math.ceil((new Date(user.demo_expires_at) - new Date()) / (1000 * 60 * 60 * 24));
    res.json({ is_demo: true, days_left: daysLeft, institution: user.institution, expires_at: user.demo_expires_at });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/demo/requests — admin view all demo requests
router.get('/requests', authenticate, requireRole('admin'), async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT dr.*, u.demo_expires_at, u.is_demo
       FROM demo_requests dr
       LEFT JOIN users u ON u.email = dr.email AND u.is_demo = true
       ORDER BY dr.created_at DESC`
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/demo/dashboard — institution-scoped dashboard data
router.get('/dashboard', authenticate, async (req, res) => {
  try {
    const userRes = await pool.query(
      'SELECT is_demo, demo_expires_at, institution, role, referred_by FROM users WHERE id=$1',
      [req.user.id]
    );
    const user = userRes.rows[0];

    if (user.role !== 'institution' && user.role !== 'admin') {
      return res.status(403).json({ error: 'Access denied' });
    }

    // Find the referral code for this institution
    let referralCode = null;
    if (user.institution) {
      const partnerRes = await pool.query(
        'SELECT referral_code FROM partners WHERE institution ILIKE $1',
        [user.institution]
      );
      if (partnerRes.rows.length > 0) {
        referralCode = partnerRes.rows[0].referral_code;
      }
    }

    // For demo accounts — get students tagged to this institution's referral code
    // or demo students seeded for this demo
    let studentsQuery;
    if (referralCode) {
      studentsQuery = await pool.query(
        `SELECT u.id, u.name, u.email, u.created_at, u.is_premium,
          COUNT(ci.id) FILTER (WHERE ci.completed=true) as tasks_done,
          COUNT(ci.id) as tasks_total,
          br.status as buddy_status,
          bp.name as buddy_name
         FROM users u
         LEFT JOIN checklist_items ci ON ci.user_id = u.id
         LEFT JOIN buddy_requests br ON br.student_id = u.id AND br.status='accepted'
         LEFT JOIN users bp ON bp.id = br.buddy_id
         WHERE u.role='student' AND u.referred_by=$1
         GROUP BY u.id, br.status, bp.name
         ORDER BY u.created_at DESC`,
        [referralCode]
      );
    } else {
      // Demo account — show demo students (is_demo = true and role = student)
      studentsQuery = await pool.query(
        `SELECT u.id, u.name, u.email, u.created_at, u.is_premium,
          COUNT(ci.id) FILTER (WHERE ci.completed=true) as tasks_done,
          COUNT(ci.id) as tasks_total,
          br.status as buddy_status,
          bp.name as buddy_name
         FROM users u
         LEFT JOIN checklist_items ci ON ci.user_id = u.id
         LEFT JOIN buddy_requests br ON br.student_id = u.id AND br.status='accepted'
         LEFT JOIN users bp ON bp.id = br.buddy_id
         WHERE u.role='student' AND u.is_demo=true
         GROUP BY u.id, br.status, bp.name
         ORDER BY u.created_at DESC`
      );
    }

    const students = studentsQuery.rows;
    const premiumCount = students.filter(s => s.is_premium).length;
    const matchedCount = students.filter(s => s.buddy_status === 'accepted').length;
    const avgChecklist = students.length > 0
      ? (students.reduce((sum, s) => sum + (parseInt(s.tasks_done) / 20 * 100), 0) / students.length).toFixed(1)
      : 0;

    // Recent activity for these students
    const studentIds = students.map(s => s.id);
    let recentActivity = [];
    if (studentIds.length > 0) {
      const activityRes = await pool.query(
        `SELECT al.action, al.created_at, u.name, u.role
         FROM activity_logs al
         JOIN users u ON u.id = al.user_id
         WHERE al.user_id = ANY($1)
         ORDER BY al.created_at DESC LIMIT 15`,
        [studentIds]
      );
      recentActivity = activityRes.rows;
    }

    const daysLeft = user.demo_expires_at
      ? Math.ceil((new Date(user.demo_expires_at) - new Date()) / (1000 * 60 * 60 * 24))
      : null;

    res.json({
      institution: user.institution,
      is_demo: user.is_demo,
      days_left: daysLeft,
      expires_at: user.demo_expires_at,
      referral_code: referralCode,
      summary: {
        total_students: students.length,
        premium_students: premiumCount,
        matched_students: matchedCount,
        avg_checklist_completion: parseFloat(avgChecklist),
        premium_rate: students.length > 0 ? Math.round((premiumCount / students.length) * 100) : 0,
        match_rate: premiumCount > 0 ? Math.round((matchedCount / premiumCount) * 100) : 0,
      },
      students,
      recent_activity: recentActivity,
    });
  } catch (err) {
    console.log('Dashboard error:', err.message);
    res.status(500).json({ error: err.message });
  }
});
module.exports = router;