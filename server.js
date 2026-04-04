const express = require('express');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// ===== basic middleware =====
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ===== temporary in-memory data =====
// This version is built to work reliably on Railway immediately.
// Data will reset after a restart/redeploy.
const users = [
  { id: 'damian', name: 'Damian', pin: '1234' },
  { id: 'james', name: 'James', pin: '2222' },
  { id: 'craig', name: 'Craig', pin: '3333' }
];

const logs = [];

// ===== pages =====
app.get('/', (req, res) => {
  res.redirect('/mobile.html');
});

app.get('/admin', (req, res) => {
  res.redirect('/admin.html');
});

// ===== api =====
app.get('/api/users', (req, res) => {
  res.json(users.map(({ id, name }) => ({ id, name })));
});

app.get('/api/logs', (req, res) => {
  res.json([...logs].reverse());
});

app.post('/api/clock', (req, res) => {
  const { userId, pin, action } = req.body || {};

  if (!userId || !pin || !action) {
    return res.status(400).json({ error: 'Missing userId, pin or action' });
  }

  if (!['in', 'out'].includes(action)) {
    return res.status(400).json({ error: 'Action must be in or out' });
  }

  const user = users.find(u => u.id === userId);
  if (!user) {
    return res.status(404).json({ error: 'User not found' });
  }

  if (String(user.pin) !== String(pin)) {
    return res.status(401).json({ error: 'Invalid PIN' });
  }

  const now = new Date();
  const entry = {
    id: Date.now().toString(),
    userId: user.id,
    name: user.name,
    action,
    time: now.toISOString(),
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

  res.json({
    success: true,
    message: `${user.name} clocked ${action}`,
    entry
  });
});

// ===== health =====
app.get('/health', (req, res) => {
  res.status(200).send('OK');
});

// ===== start =====
app.listen(PORT, '0.0.0.0', () => {
  console.log(`ClockFlow running on 0.0.0.0:${PORT}`);
});
