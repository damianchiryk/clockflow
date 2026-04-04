
const express = require('express');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// 🔐 SIMPLE ADMIN PASSWORD
const ADMIN_PASSWORD = "admin123";

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

let logs = [];
let employees = [
  { id: "damian", name: "Damian", pin: "1234", geoRequired: false }
];

// 🔐 ADMIN AUTH MIDDLEWARE
function adminAuth(req, res, next) {
  const pass = req.headers['x-admin-password'];
  if (pass !== ADMIN_PASSWORD) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  next();
}

app.get('/', (req, res) => {
  res.redirect('/mobile.html');
});

app.get('/admin.html', (req, res, next) => {
  next();
});

// API
app.get('/api/employees', (req, res) => {
  res.json(employees);
});

app.get('/api/logs', adminAuth, (req, res) => {
  res.json(logs);
});

app.post('/api/clock', (req, res) => {
  const { employeeId, pin, action } = req.body;

  const emp = employees.find(e => e.id === employeeId && e.pin === pin);
  if (!emp) return res.status(401).json({ error: "Invalid PIN" });

  const now = new Date();

  const entry = {
    name: emp.name,
    action,
    time: now.toISOString(),
    localTime: now.toLocaleString('en-GB', {
      timeZone: 'Europe/London',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    })
  };

  logs.push(entry);

  res.json({ success: true, entry });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log("SECURE ClockFlow running on " + PORT);
});
