const express = require('express');
const { pool } = require('../db');
const { authenticate } = require('../middleware/auth');
const router = express.Router();

// Get all conversations for current user
router.get('/conversations', authenticate, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT 
        c.id,
        c.created_at,
        s.id as student_id, s.name as student_name,
        b.id as buddy_id, b.name as buddy_name,
        (SELECT content FROM messages m WHERE m.conversation_id = c.id ORDER BY m.created_at DESC LIMIT 1) as last_message,
        (SELECT created_at FROM messages m WHERE m.conversation_id = c.id ORDER BY m.created_at DESC LIMIT 1) as last_message_time,
        (SELECT COUNT(*) FROM messages m WHERE m.conversation_id = c.id AND m.read = false AND m.sender_id != $1) as unread_count
      FROM conversations c
      JOIN users s ON s.id = c.student_id
      JOIN users b ON b.id = c.buddy_id
      WHERE c.student_id = $1 OR c.buddy_id = $1
      ORDER BY last_message_time DESC NULLS LAST
    `, [req.user.id]);
    res.json(result.rows);
  } catch (err) {
    console.log('Conversations error:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// Get messages for a conversation
router.get('/conversations/:id/messages', authenticate, async (req, res) => {
  try {
    // Verify user is part of this conversation
    const conv = await pool.query(
      'SELECT * FROM conversations WHERE id=$1 AND (student_id=$2 OR buddy_id=$2)',
      [req.params.id, req.user.id]
    );
    if (!conv.rows.length) return res.status(403).json({ error: 'Access denied' });

    // Mark messages as read
    await pool.query(
      'UPDATE messages SET read=true WHERE conversation_id=$1 AND sender_id!=$2',
      [req.params.id, req.user.id]
    );

    const result = await pool.query(
      `SELECT m.*, u.name as sender_name FROM messages m
       JOIN users u ON u.id = m.sender_id
       WHERE m.conversation_id = $1
       ORDER BY m.created_at ASC`,
      [req.params.id]
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// Create or get conversation between student and buddy
router.post('/conversations', authenticate, async (req, res) => {
  const { buddy_id, student_id } = req.body;
  const sId = student_id || req.user.id;
  const bId = buddy_id;

  try {
    const existing = await pool.query(
      'SELECT * FROM conversations WHERE student_id=$1 AND buddy_id=$2',
      [sId, bId]
    );
    if (existing.rows.length) return res.json(existing.rows[0]);

    const result = await pool.query(
      'INSERT INTO conversations (student_id, buddy_id) VALUES ($1,$2) RETURNING *',
      [sId, bId]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// Send a message (REST fallback)
router.post('/conversations/:id/messages', authenticate, async (req, res) => {
  const { content } = req.body;
  if (!content?.trim()) return res.status(400).json({ error: 'Message cannot be empty' });

  try {
    const conv = await pool.query(
      'SELECT * FROM conversations WHERE id=$1 AND (student_id=$2 OR buddy_id=$2)',
      [req.params.id, req.user.id]
    );
    if (!conv.rows.length) return res.status(403).json({ error: 'Access denied' });

    const result = await pool.query(
      'INSERT INTO messages (conversation_id, sender_id, content) VALUES ($1,$2,$3) RETURNING *',
      [req.params.id, req.user.id, content.trim()]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;