require('dotenv').config();

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const { createTables } = require('./db');
const authRoutes = require('./routes/auth');
const buddyRoutes = require('./routes/buddies');
const accommodationRoutes = require('./routes/accommodations');
const inviteRoutes = require('./routes/invites');
const userRoutes = require('./routes/users');
const uploadRoutes = require('./routes/upload');
const chatRoutes = require('./routes/chat');

const app = express();
const server = http.createServer(app);
const PORT = process.env.PORT || 5000;

app.use(cors({ origin: '*', credentials: false }));
app.use(express.json());

app.use('/api/auth', authRoutes);
app.use('/api/buddies', buddyRoutes);
app.use('/api/accommodations', accommodationRoutes);
app.use('/api/invites', inviteRoutes);
app.use('/api/users', userRoutes);
app.use('/api/upload', uploadRoutes);
app.use('/api/chat', chatRoutes);
app.get('/api/health', (req, res) => res.json({ status: 'ok' }));

// Socket.io setup
const io = new Server(server, {
  cors: { origin: '*', methods: ['GET','POST'] }
});

// Auth middleware for sockets
io.use((socket, next) => {
  const token = socket.handshake.auth.token;
  if (!token) return next(new Error('No token'));
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    socket.user = decoded;
    next();
  } catch {
    next(new Error('Invalid token'));
  }
});

io.on('connection', (socket) => {
  console.log('User connected:', socket.user.name);

  // Join conversation room
  socket.on('join_conversation', (conversationId) => {
    socket.join(`conv_${conversationId}`);
  });

  // Send message
  socket.on('send_message', async ({ conversationId, content }) => {
    if (!content?.trim()) return;
    try {
      const { pool } = require('./db');

      // Verify user is in conversation
      const conv = await pool.query(
        'SELECT * FROM conversations WHERE id=$1 AND (student_id=$2 OR buddy_id=$2)',
        [conversationId, socket.user.id]
      );
      if (!conv.rows.length) return;

      // Save message
      const result = await pool.query(
        'INSERT INTO messages (conversation_id, sender_id, content) VALUES ($1,$2,$3) RETURNING *',
        [conversationId, socket.user.id, content.trim()]
      );

      const message = {
        ...result.rows[0],
        sender_name: socket.user.name,
      };

      // Broadcast to everyone in the room
      io.to(`conv_${conversationId}`).emit('new_message', message);
    } catch (err) {
      console.log('Message error:', err.message);
    }
  });

  socket.on('disconnect', () => {
    console.log('User disconnected:', socket.user.name);
  });
});

createTables()
  .then(() => {
    server.listen(PORT, () => {
      console.log('Server running on port ' + PORT);
    });
  })
  .catch((err) => {
    console.log('Database error:', err.message);
    console.log('Full error:', err);
  });