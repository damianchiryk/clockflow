
const express = require('express');
const { Pool } = require('pg');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

async function initDB() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      name TEXT,
      pin TEXT
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS logs (
      id SERIAL PRIMARY KEY,
      user_id TEXT,
      name TEXT,
      action TEXT,
      time TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `);

  const res = await pool.query("SELECT * FROM users");
  if (res.rows.length === 0) {
    await pool.query(`
      INSERT INTO users (id,name,pin) VALUES
      ('damian','Damian','1234'),
      ('james','James','2222'),
      ('craig','Craig','3333')
    `);
  }
}

app.get('/api/users', async (req,res)=>{
  const r = await pool.query("SELECT id,name FROM users");
  res.json(r.rows);
});

app.get('/api/logs', async (req,res)=>{
  const r = await pool.query("SELECT * FROM logs ORDER BY time DESC");
  res.json(r.rows);
});

app.post('/api/clock', async (req,res)=>{
  const { userId, pin, action } = req.body;

  const u = await pool.query("SELECT * FROM users WHERE id=$1",[userId]);
  if(!u.rows.length) return res.status(404).json({error:"User not found"});
  if(u.rows[0].pin !== pin) return res.status(401).json({error:"Wrong PIN"});

  const r = await pool.query(
    "INSERT INTO logs (user_id,name,action) VALUES ($1,$2,$3) RETURNING *",
    [userId, u.rows[0].name, action]
  );

  res.json({success:true, entry:r.rows[0]});
});

app.listen(PORT, async ()=>{
  await initDB();
  console.log("ClockFlow DB running on "+PORT);
});
