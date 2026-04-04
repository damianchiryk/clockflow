
const express = require('express');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(express.json());
app.use(express.static('public'));

const PORT = process.env.PORT || 3000;

const usersPath = path.join(__dirname, 'data/users.json');
const logsPath = path.join(__dirname, 'data/logs.json');

function readJSON(file) {
  if (!fs.existsSync(file)) return [];
  return JSON.parse(fs.readFileSync(file));
}

function writeJSON(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public/mobile.html'));
});

app.post('/clock', (req, res) => {
  const { name, action } = req.body;
  const logs = readJSON(logsPath);

  logs.push({
    name,
    action,
    time: new Date().toISOString()
  });

  writeJSON(logsPath, logs);
  res.json({ success: true });
});

app.get('/logs', (req, res) => {
  res.json(readJSON(logsPath));
});

app.listen(PORT, () => {
  console.log("ClockFlow running on port " + PORT);
});
