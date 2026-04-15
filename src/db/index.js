const { Pool } = require('pg');

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: process.env.DB_PORT || 5432,
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME || 'settlebuddy',
});

const createTables = async () => {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      name VARCHAR(100) NOT NULL,
      email VARCHAR(150) UNIQUE NOT NULL,
      password VARCHAR(255) NOT NULL,
      role VARCHAR(20) NOT NULL CHECK (role IN ('student','buddy','admin')),
      created_at TIMESTAMP DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS buddy_profiles (
      id SERIAL PRIMARY KEY,
      user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
      origin VARCHAR(100),
      university VARCHAR(150),
      languages TEXT[],
      bio TEXT,
      available BOOLEAN DEFAULT true,
      created_at TIMESTAMP DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS accommodations (
      id SERIAL PRIMARY KEY,
      title VARCHAR(200) NOT NULL,
      location VARCHAR(150) NOT NULL,
      price INTEGER NOT NULL,
      type VARCHAR(50),
      description TEXT,
      status VARCHAR(20) DEFAULT 'available' CHECK (status IN ('available','under_offer','taken')),
      uploaded_by INTEGER REFERENCES users(id),
      created_at TIMESTAMP DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS buddy_invites (
      id SERIAL PRIMARY KEY,
      email VARCHAR(150) UNIQUE NOT NULL,
      token VARCHAR(255) UNIQUE NOT NULL,
      used BOOLEAN DEFAULT false,
      created_by INTEGER REFERENCES users(id),
      created_at TIMESTAMP DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS buddy_requests (
      id SERIAL PRIMARY KEY,
      student_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
      buddy_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
      status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending','accepted','declined')),
      created_at TIMESTAMP DEFAULT NOW(),
      UNIQUE(student_id, buddy_id)
    );
  `);
  console.log('Database tables ready');
};

module.exports = { pool, createTables };