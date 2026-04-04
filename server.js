const express = require('express');
const path = require('path');
const fs = require('fs');

const app = express();

app.use(express.json());

// 🔥 TO MUSI BYĆ
app.use(express.static(path.join(__dirname, 'public')));

const PORT = process.env.PORT || 3000;

// ===== ROUTING =====

// główna strona
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'mobile.html'));
});

// admin
app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

// ===== DATA =====

const logsFile = path.join(__dirname, 'data', 'logs.json');

function readLogs() {
  if (!fs.existsSync(logsFile)) return [];
  return JSON.parse(fs.readFileSync(logsFile));
}

function writeLogs(data) {
  fs.writeFileSync(logsFile, JSON.stringify(data, null, 2));
}

// ===== CLOCK =====

app.post('/clock', (req, res) => {
  const { name, action } = req.body;

  const logs = readLogs();

  logs.push({
    name,
    action,
    time: new Date().toISOString()
  });

  writeLogs(logs);

  res.json({ success: true });
});

// ===== LOGS =====

app.get('/logs', (req, res) => {
  res.json(readLogs());
});

// ===== START =====

app.listen(PORT, () => {
  console.log(`ClockFlow running on port ${PORT}`);
});
