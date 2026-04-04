const express = require('express');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

const DATA_DIR = path.join(__dirname, 'data');
const LOGS_FILE = path.join(DATA_DIR, 'logs.json');
const USERS_FILE = path.join(DATA_DIR, 'users.json');

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(LOGS_FILE)) fs.writeFileSync(LOGS_FILE, '[]', 'utf8');

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    return fallback;
  }
}

function writeJson(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf8');
}

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.get('/', (req, res) => {
  res.redirect('/mobile.html');
});

app.get('/api/users', (req, res) => {
  const users = readJson(USERS_FILE, []);
  res.json(users.map(u => ({ id: u.id, name: u.name })));
});

app.get('/api/logs', (req, res) => {
  const logs = readJson(LOGS_FILE, []);
  res.json(logs.slice().reverse());
});

app.post('/api/clock', (req, res) => {
  const { userId, pin, action } = req.body || {};

  if (!userId || !pin || !action) {
    return res.status(400).json({ error: 'Missing userId, pin or action' });
  }

  if (!['in', 'out'].includes(action)) {
    return res.status(400).json({ error: 'Action must be in or out' });
  }

  const users = readJson(USERS_FILE, []);
  const user = users.find(u => u.id === userId);

  if (!user) {
    return res.status(404).json({ error: 'User not found' });
  }

  if (String(user.pin) !== String(pin)) {
    return res.status(401).json({ error: 'Invalid PIN' });
  }

  const logs = readJson(LOGS_FILE, []);
  const now = new Date();

  const entry = {
    id: Date.now().toString(),
    userId: user.id,
    name: user.name,
    action,
    timestamp: now.toISOString(),
    localTime: now.toLocaleString('en-GB', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    })
  };

  logs.push(entry);
  writeJson(LOGS_FILE, logs);

  res.json({
    success: true,
    message: `${user.name} clocked ${action}`,
    entry
  });
});

app.get('/health', (req, res) => {
  res.status(200).send('OK');
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`ClockFlow listening on 0.0.0.0:${PORT}`);
});