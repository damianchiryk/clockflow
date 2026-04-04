const express = require('express');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123';

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const DATA_DIR = path.join(__dirname, 'data');
const EMPLOYEES_FILE = path.join(DATA_DIR, 'employees.json');
const LOGS_FILE = path.join(DATA_DIR, 'logs.json');
const SITES_FILE = path.join(DATA_DIR, 'sites.json');

function ensureFile(file, fallback) {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(file)) {
    fs.writeFileSync(file, JSON.stringify(fallback, null, 2), 'utf8');
  }
}

function readJson(file, fallback = []) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    return fallback;
  }
}

function writeJson(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf8');
}

ensureFile(SITES_FILE, [
  {
    "id": "vrs-east-tilbury",
    "name": "VRS East Tilbury",
    "address": "91a, Thames Industrial Park, East Tilbury, Tilbury RM18 8RH",
    "lat": 51.4848,
    "lng": 0.4122,
    "radiusMeters": 200
  },
  {
    "id": "alk-grays",
    "name": "ALK Bodyshop",
    "address": "Unit 7, Cliffside Estate, Grays RM17 5XR",
    "lat": 51.4704,
    "lng": 0.3313,
    "radiusMeters": 200
  }
]);

ensureFile(EMPLOYEES_FILE, [
  {
    "id": "damian",
    "name": "Damian",
    "pin": "1234",
    "site": "VRS Mechanical",
    "siteId": "vrs-east-tilbury",
    "hourlyRate": 0,
    "lunchMinutes": 0,
    "geoRequired": false,
    "isAdmin": true
  }
]);

ensureFile(LOGS_FILE, []);

function uid() {
  return Date.now().toString() + Math.random().toString(16).slice(2, 8);
}

function toNumber(v, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function haversineMeters(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const toRad = (d) => d * Math.PI / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
    Math.sin(dLon/2) * Math.sin(dLon/2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  return R * c;
}

function weekRangeMondayToSunday(inputDate = new Date()) {
  const d = new Date(inputDate);
  const day = d.getDay();
  const diffToMonday = day === 0 ? -6 : 1 - day;
  const monday = new Date(d);
  monday.setHours(0,0,0,0);
  monday.setDate(d.getDate() + diffToMonday);

  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  sunday.setHours(23,59,59,999);

  return { monday, sunday };
}


function formatLondon(date) {
  return new Date(date).toLocaleString('en-GB', {
    timeZone: 'Europe/London',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  });
}

function requireAdmin(req, res, next) {
  const password = req.headers['x-admin-password'];
  if (String(password || '') !== String(ADMIN_PASSWORD)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
}

// pages
app.get('/', (req, res) => res.redirect('/mobile.html'));
app.get('/admin', (req, res) => res.redirect('/admin.html'));

// health
app.get('/health', (req, res) => res.status(200).send('OK'));

app.post('/api/admin-login', (req, res) => {
  const { password } = req.body || {};
  if (String(password || '') !== String(ADMIN_PASSWORD)) {
    return res.status(401).json({ error: 'Invalid admin password' });
  }
  res.json({ success: true });
});

// sites
app.get('/api/sites', requireAdmin, (req, res) => {
  res.json(readJson(SITES_FILE, []));
});

// employees
app.get('/api/employees', (req, res) => {
  const employees = readJson(EMPLOYEES_FILE, []);
  res.json(employees.map(({ pin, ...rest }) => rest));
});

app.post('/api/employees', requireAdmin, (req, res) => {
  const employees = readJson(EMPLOYEES_FILE, []);
  const {
    name,
    pin,
    site,
    siteId,
    hourlyRate,
    lunchMinutes,
    geoRequired,
    isAdmin
  } = req.body || {};

  if (!name || !pin || !site || !siteId) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  const employee = {
    id: uid(),
    name: String(name).trim(),
    pin: String(pin).trim(),
    site: String(site).trim(),
    siteId: String(siteId).trim(),
    hourlyRate: toNumber(hourlyRate, 0),
    lunchMinutes: toNumber(lunchMinutes, 0),
    geoRequired: Boolean(geoRequired),
    isAdmin: Boolean(isAdmin)
  };

  employees.push(employee);
  writeJson(EMPLOYEES_FILE, employees);
  res.json({ success: true, employee });
});

app.put('/api/employees/:id', requireAdmin, (req, res) => {
  const employees = readJson(EMPLOYEES_FILE, []);
  const idx = employees.findIndex(e => e.id === req.params.id);
  if (idx === -1) {
    return res.status(404).json({ error: 'Employee not found' });
  }

  const current = employees[idx];
  const next = {
    ...current,
    ...req.body,
    hourlyRate: toNumber(req.body?.hourlyRate ?? current.hourlyRate, current.hourlyRate),
    lunchMinutes: toNumber(req.body?.lunchMinutes ?? current.lunchMinutes, current.lunchMinutes),
    geoRequired: req.body?.geoRequired === undefined ? current.geoRequired : Boolean(req.body.geoRequired),
    isAdmin: req.body?.isAdmin === undefined ? current.isAdmin : Boolean(req.body.isAdmin)
  };

  employees[idx] = next;
  writeJson(EMPLOYEES_FILE, employees);
  res.json({ success: true, employee: next });
});

app.delete('/api/employees/:id', requireAdmin, (req, res) => {
  let employees = readJson(EMPLOYEES_FILE, []);
  const before = employees.length;
  employees = employees.filter(e => e.id !== req.params.id);
  if (employees.length === before) {
    return res.status(404).json({ error: 'Employee not found' });
  }
  writeJson(EMPLOYEES_FILE, employees);
  res.json({ success: true });
});

// clock
app.post('/api/clock', (req, res) => {
  const { employeeId, pin, action, lat, lng } = req.body || {};

  if (!employeeId || !pin || !action) {
    return res.status(400).json({ error: 'Missing employeeId, pin or action' });
  }

  if (!['in', 'out'].includes(action)) {
    return res.status(400).json({ error: 'Action must be in or out' });
  }

  const employees = readJson(EMPLOYEES_FILE, []);
  const sites = readJson(SITES_FILE, []);
  const logs = readJson(LOGS_FILE, []);

  const employee = employees.find(e => e.id === employeeId);
  if (!employee) return res.status(404).json({ error: 'Employee not found' });
  if (String(employee.pin) !== String(pin)) return res.status(401).json({ error: 'Invalid PIN' });

  const site = sites.find(s => s.id === employee.siteId);

  let geo = {
    required: Boolean(employee.geoRequired),
    allowed: true,
    distanceMeters: null,
    siteName: site?.name || employee.site
  };

  if (employee.geoRequired) {
    if (lat === undefined || lng === undefined || !site) {
      return res.status(400).json({ error: 'Location is required for this employee' });
    }

    const distance = haversineMeters(Number(lat), Number(lng), Number(site.lat), Number(site.lng));
    geo.distanceMeters = Math.round(distance);
    geo.allowed = distance <= Number(site.radiusMeters || 200);

    if (!geo.allowed) {
      return res.status(403).json({
        error: `Outside allowed area. Distance: ${geo.distanceMeters}m. Limit: ${site.radiusMeters}m`
      });
    }
  }

  const now = new Date();
  const entry = {
    id: uid(),
    employeeId: employee.id,
    name: employee.name,
    site: employee.site,
    siteId: employee.siteId,
    action,
    time: now.toISOString(),
    localTime: formatLondon(now),
    lat: lat ?? null,
    lng: lng ?? null,
    geo
  };

  logs.push(entry);
  writeJson(LOGS_FILE, logs);

  res.json({
    success: true,
    message: `${employee.name} clocked ${action}`,
    entry
  });
});

app.get('/api/logs', requireAdmin, (req, res) => {
  const logs = readJson(LOGS_FILE, []);
  res.json([...logs].reverse());
});

// payroll report
app.get('/api/reports/weekly', requireAdmin, (req, res) => {
  const employees = readJson(EMPLOYEES_FILE, []);
  const logs = readJson(LOGS_FILE, []);
  const { monday, sunday } = weekRangeMondayToSunday(new Date());

  const inRange = logs.filter(log => {
    const t = new Date(log.time);
    return t >= monday && t <= sunday;
  });

  const report = employees.map(emp => {
    const mine = inRange
      .filter(l => l.employeeId === emp.id)
      .sort((a, b) => new Date(a.time) - new Date(b.time));

    let totalMs = 0;
    let openIn = null;

    for (const row of mine) {
      if (row.action === 'in') {
        openIn = row;
      } else if (row.action === 'out' && openIn) {
        totalMs += new Date(row.time) - new Date(openIn.time);
        openIn = null;
      }
    }

    const totalHoursRaw = totalMs / 1000 / 60 / 60;
    const lunchHours = (Number(emp.lunchMinutes || 0) / 60) * Math.max(0, Math.floor(totalHoursRaw > 0 ? mine.filter(x => x.action === 'in').length : 0));
    const paidHours = Math.max(0, totalHoursRaw - lunchHours);
    const grossPay = paidHours * Number(emp.hourlyRate || 0);

    return {
      employeeId: emp.id,
      name: emp.name,
      site: emp.site,
      hourlyRate: Number(emp.hourlyRate || 0),
      lunchMinutes: Number(emp.lunchMinutes || 0),
      totalHoursRaw: Number(totalHoursRaw.toFixed(2)),
      paidHours: Number(paidHours.toFixed(2)),
      grossPay: Number(grossPay.toFixed(2)),
      logs: mine.length
    };
  });

  res.json({
    weekStart: monday.toISOString(),
    weekEnd: sunday.toISOString(),
    report
  });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`ClockFlow PRO running on 0.0.0.0:${PORT}`);
});
