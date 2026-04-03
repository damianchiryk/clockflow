
const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const app = express();
const PORT = 4000;
const DB_FILE = path.join(__dirname, 'data', 'db.json');
const sessions = new Map();

app.use(express.json());
app.use('/static', express.static(path.join(__dirname, 'public')));

function defaultDb() {
  return {
    sites: [
      { id: 'site-vrs', name: 'VRS Bodyshop', latitude: 51.4805, longitude: 0.2777, radiusMeters: 120 },
      { id: 'site-alk', name: 'ALK Vehicle Solutions', latitude: 51.4840, longitude: 0.2820, radiusMeters: 120 }
    ],
    users: [
      {
        id: 'u-admin',
        fullName: 'Damian',
        login: 'admin',
        password: 'Admin123!',
        role: 'ADMIN',
        siteId: 'site-vrs',
        hourlyRate: 0,
        lunchMinutes: 0,
        minimumDailyMinutes: 0,
        mustChangePassword: false,
        active: true,
        geofenceBypass: true,
        createdAt: new Date().toISOString()
      },
      {
        id: 'u-test',
        fullName: 'Test Anywhere',
        login: 'test.anywhere',
        password: 'Test123!',
        role: 'EMPLOYEE',
        siteId: 'site-vrs',
        hourlyRate: 20,
        lunchMinutes: 0,
        minimumDailyMinutes: 0,
        mustChangePassword: false,
        active: true,
        geofenceBypass: true,
        createdAt: new Date().toISOString()
      }
    ],
    attendanceEvents: []
  };
}

function ensureDb() {
  fs.mkdirSync(path.dirname(DB_FILE), { recursive: true });
  if (!fs.existsSync(DB_FILE)) {
    fs.writeFileSync(DB_FILE, JSON.stringify(defaultDb(), null, 2));
  } else {
    try {
      const parsed = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
      if (!parsed.sites || !parsed.users) {
        fs.writeFileSync(DB_FILE, JSON.stringify(defaultDb(), null, 2));
      }
    } catch {
      fs.writeFileSync(DB_FILE, JSON.stringify(defaultDb(), null, 2));
    }
  }
}

function dbRead() {
  ensureDb();
  const db = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
  db.sites = Array.isArray(db.sites) ? db.sites : defaultDb().sites;
  db.users = Array.isArray(db.users) ? db.users : defaultDb().users;
  db.attendanceEvents = Array.isArray(db.attendanceEvents) ? db.attendanceEvents : [];
  return db;
}

function dbWrite(db) {
  fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
}

function sanitizeUser(user) {
  const { password, ...safe } = user;
  return safe;
}

function auth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  const session = sessions.get(token);
  if (!session) return res.status(401).json({ error: 'Missing or invalid token' });
  req.user = session;
  next();
}

function adminOnly(req, res, next) {
  if (req.user.role !== 'ADMIN') return res.status(403).json({ error: 'Forbidden' });
  next();
}

function distanceMeters(lat1, lon1, lat2, lon2) {
  const toRad = (v) => (v * Math.PI) / 180;
  const R = 6371000;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function getOpenShift(events, userId) {
  const list = events
    .filter(e => e.userId === userId)
    .sort((a,b) => new Date(a.createdAt) - new Date(b.createdAt));
  let open = null;
  for (const ev of list) {
    if (ev.type === 'CLOCK_IN') open = ev;
    if (ev.type === 'CLOCK_OUT') open = null;
  }
  return open;
}

function buildWeeklyReport(db) {
  const rows = [];
  for (const user of db.users.filter(u => u.role === 'EMPLOYEE' && u.active)) {
    const events = db.attendanceEvents
      .filter(e => e.userId === user.id)
      .sort((a,b) => new Date(a.createdAt) - new Date(b.createdAt));

    let totalMs = 0;
    let lastIn = null;
    for (const ev of events) {
      if (ev.type === 'CLOCK_IN') lastIn = new Date(ev.createdAt);
      if (ev.type === 'CLOCK_OUT' && lastIn) {
        totalMs += new Date(ev.createdAt) - lastIn;
        lastIn = null;
      }
    }

    const totalHoursRaw = totalMs / 1000 / 60 / 60;
    const lunchHoursRaw = (user.lunchMinutes || 0) / 60;
    const payableHoursRaw = Math.max(0, totalHoursRaw - lunchHoursRaw);
    const grossPayRaw = payableHoursRaw * Number(user.hourlyRate || 0);

    rows.push({
      employee: user.fullName,
      login: user.login,
      site: db.sites.find(s => s.id === user.siteId)?.name || user.siteId,
      hourlyRate: Number(user.hourlyRate || 0).toFixed(2),
      totalHours: totalHoursRaw.toFixed(2),
      lunchHours: lunchHoursRaw.toFixed(2),
      payableHours: payableHoursRaw.toFixed(2),
      grossPay: grossPayRaw.toFixed(2),
      belowMinimumDays: 0
    });
  }

  return {
    weekEnding: new Date().toISOString().slice(0, 10),
    rows,
    totals: { grossPay: rows.reduce((sum, r) => sum + Number(r.grossPay), 0).toFixed(2) }
  };
}

app.get('/', (req,res) => res.redirect('/admin'));
app.get('/admin', (req,res) => res.sendFile(path.join(__dirname, 'public', 'admin.html')));
app.get('/mobile', (req,res) => res.sendFile(path.join(__dirname, 'public', 'mobile.html')));

app.post('/api/auth/login', (req,res) => {
  const db = dbRead();
  const { login, password } = req.body || {};
  const user = db.users.find(u => u.login === login && u.password === password && u.active);
  if (!user) return res.status(401).json({ error: 'Invalid login' });
  const token = crypto.randomBytes(24).toString('hex');
  sessions.set(token, { id: user.id, role: user.role, siteId: user.siteId, fullName: user.fullName });
  res.json({ token, user: sanitizeUser(user) });
});

app.post('/api/auth/change-password', auth, (req,res) => {
  const db = dbRead();
  const user = db.users.find(u => u.id === req.user.id);
  if (!user) return res.status(404).json({ error: 'User not found' });
  const { currentPassword, newPassword } = req.body || {};
  if (user.password !== currentPassword) return res.status(400).json({ error: 'Current password is incorrect' });
  if (!newPassword || newPassword.length < 4) return res.status(400).json({ error: 'New password too short' });
  user.password = newPassword;
  user.mustChangePassword = false;
  dbWrite(db);
  res.json({ success: true, user: sanitizeUser(user) });
});

app.get('/api/me', auth, (req,res) => {
  const db = dbRead();
  const user = db.users.find(u => u.id === req.user.id);
  const site = db.sites.find(s => s.id === user.siteId) || null;
  res.json({ user: sanitizeUser(user), site });
});

app.get('/api/sites', auth, (req,res) => {
  res.json(dbRead().sites);
});

app.get('/api/attendance/me', auth, (req,res) => {
  const db = dbRead();
  res.json(
    db.attendanceEvents
      .filter(e => e.userId === req.user.id)
      .sort((a,b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, 50)
  );
});

app.post('/api/attendance/punch', auth, (req,res) => {
  const db = dbRead();
  const user = db.users.find(u => u.id === req.user.id);
  const site = db.sites.find(s => s.id === user.siteId);
  if (!user) return res.status(404).json({ error: 'User not found' });
  if (!site) return res.status(404).json({ error: 'Site not found' });

  const { latitude, longitude, accuracy, type } = req.body || {};
  if (!['CLOCK_IN', 'CLOCK_OUT'].includes(type)) return res.status(400).json({ error: 'Invalid punch type' });

  const dist = distanceMeters(Number(latitude), Number(longitude), Number(site.latitude), Number(site.longitude));
  const insideGeofence = user.geofenceBypass ? true : dist <= Number(site.radiusMeters || 0);
  if (!insideGeofence) return res.status(400).json({ error: 'Outside allowed site geofence' });

  const openShift = getOpenShift(db.attendanceEvents, user.id);
  if (type === 'CLOCK_IN' && openShift) return res.status(400).json({ error: 'Already clocked in' });
  if (type === 'CLOCK_OUT' && !openShift) return res.status(400).json({ error: 'No open shift to clock out from' });

  const event = {
    id: `ev-${Date.now()}`,
    userId: user.id,
    siteId: site.id,
    type,
    latitude: Number(latitude),
    longitude: Number(longitude),
    accuracy: Number(accuracy || 0),
    distanceMeters: Math.round(dist),
    insideGeofence,
    createdAt: new Date().toISOString()
  };
  db.attendanceEvents.push(event);
  dbWrite(db);
  res.json({ success: true, event });
});

app.get('/api/admin/dashboard', auth, adminOnly, (req,res) => {
  const db = dbRead();
  const employees = db.users.filter(u => u.role === 'EMPLOYEE' && u.active);
  const activeNow = employees.filter(u => getOpenShift(db.attendanceEvents, u.id)).length;
  const weekly = buildWeeklyReport(db);
  res.json({
    metrics: {
      employees: employees.length,
      activeNow,
      sites: db.sites.length,
      projectedPayroll: weekly.totals.grossPay
    }
  });
});

app.get('/api/admin/employees', auth, adminOnly, (req,res) => {
  const db = dbRead();
  const rows = db.users.filter(u => u.role === 'EMPLOYEE').map(u => ({
    ...sanitizeUser(u),
    siteName: db.sites.find(s => s.id === u.siteId)?.name || u.siteId,
    isClockedIn: Boolean(getOpenShift(db.attendanceEvents, u.id))
  }));
  res.json(rows);
});

app.post('/api/admin/employees', auth, adminOnly, (req,res) => {
  const { fullName, siteId, hourlyRate, lunchMinutes, minimumDailyMinutes, geofenceBypass } = req.body || {};
  if (!fullName || !siteId) return res.status(400).json({ error: 'fullName and siteId are required' });
  const db = dbRead();

  const safeLoginBase = fullName.toLowerCase().replace(/[^a-z0-9]+/g, '.').replace(/^\.+|\.+$/g, '') || 'employee';
  let login = safeLoginBase;
  let i = 1;
  while (db.users.find(u => u.login === login)) login = `${safeLoginBase}${i++}`;

  const tempPassword = `Vrs#${Math.floor(1000 + Math.random() * 9000)}`;
  const employee = {
    id: `u-${Date.now()}`,
    fullName,
    login,
    password: tempPassword,
    role: 'EMPLOYEE',
    siteId,
    hourlyRate: Number(hourlyRate || 0),
    lunchMinutes: Number(lunchMinutes || 0),
    minimumDailyMinutes: Number(minimumDailyMinutes || 0),
    mustChangePassword: true,
    active: true,
    geofenceBypass: Boolean(geofenceBypass),
    createdAt: new Date().toISOString()
  };
  db.users.push(employee);
  dbWrite(db);
  res.json({ success: true, generatedCredentials: { login, tempPassword }, employee: sanitizeUser(employee) });
});

app.get('/api/admin/payroll/weekly', auth, adminOnly, (req,res) => {
  res.json(buildWeeklyReport(dbRead()));
});

ensureDb();
app.listen(PORT, () => {
  console.log(`ClockFlow running on http://localhost:${PORT}`);
  console.log(`Admin:  http://localhost:${PORT}/admin`);
  console.log(`Mobile: http://localhost:${PORT}/mobile`);
});
