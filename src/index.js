const dotenv = require('dotenv');
dotenv.config();

const express = require('express');
const cors = require('cors');
const { createTables } = require('./db');
const authRoutes = require('./routes/auth');
const buddyRoutes = require('./routes/buddies');
const accommodationRoutes = require('./routes/accommodations');
const inviteRoutes = require('./routes/invites');
const userRoutes = require('./routes/users');

const app = express();
const PORT = process.env.PORT || 5000;

app.use(cors({
  origin: '*',
  credentials: false,
}));
app.use(express.json());

app.use('/api/auth', authRoutes);
app.use('/api/buddies', buddyRoutes);
app.use('/api/accommodations', accommodationRoutes);
app.use('/api/invites', inviteRoutes);
app.use('/api/users', userRoutes);
app.get('/api/health', (req, res) => res.json({ status: 'ok' }));

createTables()
  .then(() => {
    app.listen(PORT, () => {
      console.log('Server running on http://localhost:' + PORT);
    });
  })
  .catch((err) => {
    console.log('Database error:', err.message);
    console.log('Full error:', err);
  });