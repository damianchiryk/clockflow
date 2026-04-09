const express = require('express');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const ExcelJS = require('exceljs');
const PDFDocument = require('pdfkit');

const app = express();
const PORT = process.env.PORT || 3000;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123';
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const PUBLIC_DIR = path.join(__dirname, 'public');
const UPLOADS_DIR = path.join(DATA_DIR, 'uploads');
const EMPLOYEES_FILE = path.join(DATA_DIR, 'employees.json');
const LOGS_FILE = path.join(DATA_DIR, 'logs.json');
const SITES_FILE = path.join(DATA_DIR, 'sites.json');
const FAILED_FILE = path.join(DATA_DIR, 'failed_attempts.json');
const USERS_FILE = path.join(DATA_DIR, 'users.json');

app.use(express.json({ limit: '25mb' }));
app.use(express.static(PUBLIC_DIR));
app.use('/uploads', express.static(UPLOADS_DIR));

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}
function ensureFile(file, fallback) {
  ensureDir(path.dirname(file));
  if (!fs.existsSync(file)) fs.writeFileSync(file, JSON.stringify(fallback, null, 2), 'utf8');
}
function readJson(file, fallback = []) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}
function writeJson(file, data) {
  ensureDir(path.dirname(file));
  fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf8');
}
function uid() {
  return Date.now().toString() + Math.random().toString(16).slice(2, 8);
}
function toNumber(v, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}
function sanitizeText(v = '') {
  return String(v).trim();
}
function formatLondon(date) {
  return new Date(date).toLocaleString('en-GB', {
    timeZone: 'Europe/London',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit'
  });
}
function dateLondon(date) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(date));
}
function timeLondon(date) {
  return new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).format(new Date(date));
}
function startEndOfDayLondon(dateStr) {
  const d = dateStr ? new Date(`${dateStr}T12:00:00`) : new Date();
  const dayInUK = new Date(new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d) + 'T00:00:00');
  const next = new Date(dayInUK);
  next.setDate(dayInUK.getDate() + 1);
  return { start: dayInUK, end: next };
}
function weekRangeMondayToSunday(inputDate = new Date()) {
  const ukDateStr = dateLondon(inputDate);
  const d = new Date(`${ukDateStr}T12:00:00Z`);
  const day = d.getUTCDay();
  const diff = day === 0 ? -6 : 1 - day;
  const monday = new Date(d);
  monday.setUTCDate(d.getUTCDate() + diff);
  monday.setUTCHours(0, 0, 0, 0);
  const sunday = new Date(monday);
  sunday.setUTCDate(monday.getUTCDate() + 6);
  sunday.setUTCHours(23, 59, 59, 999);
  return { monday, sunday };
}
function haversineMeters(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const toRad = d => d * Math.PI / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
function adminOnly(req, res, next) {
  const password = req.headers['x-admin-password'] || req.query.adminPassword || req.query.password;
  if (String(password || '') !== String(ADMIN_PASSWORD)) return res.status(401).json({ error: 'Unauthorized' });
  next();
}
function employeeSafe(employee) {
  if (!employee) return null;
  const { pin, ...rest } = employee;
  return rest;
}
function authenticateEmployee(login, pin) {
  const employees = readJson(EMPLOYEES_FILE, []);
  return employees.find(e => String(e.login || '').toLowerCase() === String(login || '').trim().toLowerCase() && String(e.pin) === String(pin));
}
function authenticateEmployeeById(employeeId, pin) {
  const employees = readJson(EMPLOYEES_FILE, []);
  return employees.find(e => e.id === employeeId && String(e.pin) === String(pin));
}
function buildLogEntry({ employee, action, timeISO, lat = null, lng = null, geo, source = 'mobile', notes = '' }) {
  return {
    id: uid(),
    employeeId: employee.id,
    name: employee.name,
    site: employee.site,
    siteId: employee.siteId,
    action,
    time: timeISO,
    localTime: formatLondon(timeISO),
    lat,
    lng,
    geo,
    source,
    notes
  };
}
function getEmployeeCurrentState(employeeId, logs) {
  const mine = [...logs].filter(l => l.employeeId === employeeId).sort((a, b) => new Date(a.time) - new Date(b.time));
  let open = false;
  for (const log of mine) {
    if (log.action === 'in') open = true;
    if (log.action === 'out') open = false;
  }
  return { currentlyClockedIn: open, lastLog: mine[mine.length - 1] || null };
}
function compensationSummaryForEmployee(employee, logs, weekStart, weekEnd) {
  const mine = logs.filter(l => l.employeeId === employee.id).filter(l => {
    const t = new Date(l.time);
    return t >= weekStart && t <= weekEnd;
  }).sort((a, b) => new Date(a.time) - new Date(b.time));
  let totalMs = 0;
  let openIn = null;
  const rows = [];
  for (const log of mine) {
    if (log.action === 'in') openIn = log;
    else if (log.action === 'out' && openIn) {
      const ms = Math.max(0, new Date(log.time) - new Date(openIn.time));
      totalMs += ms;
      rows.push({ in: openIn, out: log, ms });
      openIn = null;
    }
  }
  const totalHoursRaw = totalMs / 36e5;
  const lunchHours = (toNumber(employee.lunchMinutes, 0) / 60) * rows.length;
  const paidHours = Math.max(0, totalHoursRaw - lunchHours);
  const compensationType = employee.compensationType || employee.payType || 'hourly';
  const compensationRate = toNumber(employee.compensationRate ?? employee.hourlyRate ?? employee.dailyRate ?? employee.weeklyRate ?? 0, 0);
  let totalPay = 0;
  if (compensationType === 'hourly') totalPay = paidHours * compensationRate;
  else if (compensationType === 'daily') totalPay = rows.length * compensationRate;
  else if (compensationType === 'weekly') totalPay = rows.length > 0 ? compensationRate : 0;
  else if (compensationType === 'monthly') totalPay = rows.length > 0 || !employee.mustClock ? compensationRate : 0;
  totalPay -= toNumber(employee.advanceBalance, 0);
  return {
    employeeId: employee.id,
    name: employee.name,
    site: employee.site,
    compensationType,
    compensationRate,
    lunchMinutes: toNumber(employee.lunchMinutes, 0),
    totalHoursRaw: Number(totalHoursRaw.toFixed(2)),
    paidHours: Number(paidHours.toFixed(2)),
    totalPay: Number(totalPay.toFixed(2)),
    daysWorked: rows.length,
    advanceBalance: toNumber(employee.advanceBalance, 0)
  };
}
function dailyRowsForEmployee(employee, logs, weekStart, weekEnd) {
  const mine = logs.filter(l => l.employeeId === employee.id).filter(l => {
    const t = new Date(l.time);
    return t >= weekStart && t <= weekEnd;
  }).sort((a, b) => new Date(a.time) - new Date(b.time));
  let openIn = null;
  const rows = [];
  for (const log of mine) {
    if (log.action === 'in') openIn = log;
    else if (log.action === 'out' && openIn) {
      const hours = Math.max(0, (new Date(log.time) - new Date(openIn.time)) / 36e5);
      rows.push({
        name: employee.name,
        site: employee.site,
        date: dateLondon(openIn.time),
        clockInTime: timeLondon(openIn.time),
        clockOutTime: timeLondon(log.time),
        totalHours: Number(hours.toFixed(2)),
        hourlyRate: toNumber(employee.compensationRate ?? employee.hourlyRate ?? 0),
        totalPay: Number((compensationSummaryForEmployee(employee, [openIn, log], new Date('2000-01-01'), new Date('2100-01-01')).totalPay).toFixed(2))
      });
      openIn = null;
    }
  }
  return rows;
}
function paginate(items, page = 1, limit = 20) {
  const total = items.length;
  const totalPages = Math.max(1, Math.ceil(total / limit));
  const safePage = Math.min(Math.max(1, Number(page || 1)), totalPages);
  const start = (safePage - 1) * limit;
  return {
    items: items.slice(start, start + limit),
    pagination: { page: safePage, limit, total, totalPages, hasNext: safePage < totalPages, hasPrev: safePage > 1 }
  };
}
function ensureSeed() {
  ensureDir(DATA_DIR);
  ensureDir(UPLOADS_DIR);
  ensureFile(SITES_FILE, [
    { id: 'vrs-mechanical', name: 'VRS Mechanical', address: '91a, Thames Industrial Park, East Tilbury, Tilbury RM18 8RH', lat: 51.47873004008197, lng: 0.4137913929600394, radiusMeters: 50 },
    { id: 'vrs-east-tilbury', name: 'VRS Bodyshop', address: '91a, Thames Industrial Park, East Tilbury, Tilbury RM18 8RH', lat: 51.47873004008197, lng: 0.4137913929600394, radiusMeters: 50 },
    { id: 'alk-grays', name: 'ALK Bodyshop', address: 'Unit 7, Cliffside Estate, Grays RM17 5XR', lat: 51.4838239, lng: 0.3094763, radiusMeters: 50 }
  ]);
  ensureFile(EMPLOYEES_FILE, []);
  ensureFile(LOGS_FILE, []);
  ensureFile(FAILED_FILE, []);
  ensureFile(USERS_FILE, []);
}
ensureSeed();

app.get('/', (req, res) => res.redirect('/mobile.html'));
app.get('/admin', (req, res) => res.redirect('/admin.html'));
app.get('/health', (req, res) => res.status(200).send('OK'));

app.post('/api/admin-login', (req, res) => {
  const { password } = req.body || {};
  if (String(password || '') !== String(ADMIN_PASSWORD)) return res.status(401).json({ error: 'Invalid admin password' });
  res.json({ success: true });
});

app.get('/api/sites', adminOnly, (req, res) => res.json(readJson(SITES_FILE, [])));
app.get('/api/employees', (req, res) => res.json(readJson(EMPLOYEES_FILE, []).map(employeeSafe)));
app.post('/api/employees', adminOnly, (req, res) => {
  const employees = readJson(EMPLOYEES_FILE, []);
  const body = req.body || {};
  if (!body.name || !body.pin || !body.site || !body.siteId) return res.status(400).json({ error: 'Missing required fields' });
  const compensationType = sanitizeText(body.compensationType || body.payType || 'hourly');
  const compensationRate = toNumber(body.compensationRate ?? body.hourlyRate ?? body.dailyRate ?? body.weeklyRate ?? body.monthlyRate, 0);
  const employee = {
    id: uid(),
    name: sanitizeText(body.name),
    login: sanitizeText(body.login || body.name).toLowerCase().replace(/\s+/g, '.'),
    pin: sanitizeText(body.pin),
    site: sanitizeText(body.site),
    siteId: sanitizeText(body.siteId),
    payType: compensationType,
    hourlyRate: toNumber(body.hourlyRate ?? compensationRate, 0),
    dailyRate: toNumber(body.dailyRate ?? 0, 0),
    weeklyRate: toNumber(body.weeklyRate ?? 0, 0),
    monthlyRate: toNumber(body.monthlyRate ?? 0, 0),
    compensationType,
    compensationRate,
    lunchMinutes: toNumber(body.lunchMinutes, 0),
    geoRequired: body.geoRequired === undefined ? true : Boolean(body.geoRequired),
    isAdmin: Boolean(body.isAdmin),
    mustClock: body.mustClock === undefined ? true : Boolean(body.mustClock),
    mustChangePin: Boolean(body.mustChangePin),
    advanceBalance: toNumber(body.advanceBalance, 0),
    documents: []
  };
  employees.push(employee);
  writeJson(EMPLOYEES_FILE, employees);
  res.json({ success: true, employee: employeeSafe(employee) });
});
app.put('/api/employees/:id', adminOnly, (req, res) => {
  const employees = readJson(EMPLOYEES_FILE, []);
  const idx = employees.findIndex(e => e.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Employee not found' });
  const current = employees[idx];
  const body = req.body || {};
  const compensationType = sanitizeText(body.compensationType ?? current.compensationType ?? current.payType ?? 'hourly');
  const compensationRate = toNumber(body.compensationRate ?? body.hourlyRate ?? body.dailyRate ?? body.weeklyRate ?? body.monthlyRate ?? current.compensationRate ?? current.hourlyRate ?? 0, current.compensationRate ?? 0);
  const next = {
    ...current,
    name: body.name !== undefined ? sanitizeText(body.name) : current.name,
    login: body.login !== undefined ? sanitizeText(body.login).toLowerCase() : current.login,
    pin: body.pin !== undefined && String(body.pin).trim() !== '' ? sanitizeText(body.pin) : current.pin,
    site: body.site !== undefined ? sanitizeText(body.site) : current.site,
    siteId: body.siteId !== undefined ? sanitizeText(body.siteId) : current.siteId,
    payType: compensationType,
    compensationType,
    compensationRate,
    hourlyRate: toNumber(body.hourlyRate ?? current.hourlyRate ?? compensationRate, current.hourlyRate ?? 0),
    dailyRate: toNumber(body.dailyRate ?? current.dailyRate, current.dailyRate ?? 0),
    weeklyRate: toNumber(body.weeklyRate ?? current.weeklyRate, current.weeklyRate ?? 0),
    monthlyRate: toNumber(body.monthlyRate ?? current.monthlyRate, current.monthlyRate ?? 0),
    lunchMinutes: toNumber(body.lunchMinutes ?? current.lunchMinutes, current.lunchMinutes),
    geoRequired: body.geoRequired === undefined ? current.geoRequired : Boolean(body.geoRequired),
    isAdmin: body.isAdmin === undefined ? current.isAdmin : Boolean(body.isAdmin),
    mustClock: body.mustClock === undefined ? current.mustClock : Boolean(body.mustClock),
    mustChangePin: body.mustChangePin === undefined ? current.mustChangePin : Boolean(body.mustChangePin),
    advanceBalance: toNumber(body.advanceBalance ?? current.advanceBalance, current.advanceBalance),
    documents: Array.isArray(current.documents) ? current.documents : []
  };
  employees[idx] = next;
  writeJson(EMPLOYEES_FILE, employees);
  res.json({ success: true, employee: employeeSafe(next) });
});
app.delete('/api/employees/:id', adminOnly, (req, res) => {
  let employees = readJson(EMPLOYEES_FILE, []);
  const before = employees.length;
  employees = employees.filter(e => e.id !== req.params.id);
  if (employees.length === before) return res.status(404).json({ error: 'Employee not found' });
  writeJson(EMPLOYEES_FILE, employees);
  res.json({ success: true });
});

function recordFailedAttempt(payload) {
  const failed = readJson(FAILED_FILE, []);
  failed.push({ id: uid(), time: new Date().toISOString(), localTime: formatLondon(new Date()), ...payload });
  writeJson(FAILED_FILE, failed);
}

app.post('/api/mobile-login', (req, res) => {
  const { login, pin } = req.body || {};
  const employee = authenticateEmployee(login, pin);
  if (!employee) return res.status(401).json({ error: 'Invalid login or PIN' });
  const logs = readJson(LOGS_FILE, []);
  const state = getEmployeeCurrentState(employee.id, logs);
  res.json({ success: true, employee: employeeSafe(employee), state });
});

app.get('/api/mobile-logs', (req, res) => {
  const { employeeId, pin } = req.query;
  const employee = authenticateEmployeeById(employeeId, pin);
  if (!employee) return res.status(401).json({ error: 'Unauthorized' });
  const logs = readJson(LOGS_FILE, []).filter(l => l.employeeId === employee.id).sort((a, b) => new Date(b.time) - new Date(a.time)).slice(0, 50);
  res.json(logs);
});

app.get('/api/mobile-documents', (req, res) => {
  const { employeeId, pin } = req.query;
  const employee = authenticateEmployeeById(employeeId, pin);
  if (!employee) return res.status(401).json({ error: 'Unauthorized' });
  res.json(employee.documents || []);
});

app.post('/api/documents/upload', (req, res) => {
  const { employeeId, pin, docType, fileName, mimeType, dataBase64 } = req.body || {};
  const employees = readJson(EMPLOYEES_FILE, []);
  const idx = employees.findIndex(e => e.id === employeeId && String(e.pin) === String(pin));
  if (idx === -1) return res.status(401).json({ error: 'Unauthorized' });
  if (!dataBase64 || !fileName) return res.status(400).json({ error: 'Missing file data' });
  ensureDir(UPLOADS_DIR);
  const ext = path.extname(fileName) || '.bin';
  const storedAs = `${employees[idx].login || employees[idx].id}-${Date.now()}-${sanitizeText(docType || 'other')}${ext}`.replace(/[^a-zA-Z0-9._-]/g, '-');
  const filePath = path.join(UPLOADS_DIR, storedAs);
  fs.writeFileSync(filePath, Buffer.from(dataBase64, 'base64'));
  const doc = {
    id: uid(),
    docType: sanitizeText(docType || 'other') || 'other',
    fileName,
    storedAs,
    mimeType: mimeType || 'application/octet-stream',
    uploadedAt: new Date().toISOString(),
    uploadedAtLocal: formatLondon(new Date())
  };
  employees[idx].documents = Array.isArray(employees[idx].documents) ? employees[idx].documents : [];
  employees[idx].documents.unshift(doc);
  writeJson(EMPLOYEES_FILE, employees);
  res.json({ success: true, document: doc });
});

app.post('/api/clock', (req, res) => {
  const { employeeId, pin, action, lat, lng } = req.body || {};
  if (!employeeId || !pin || !action) return res.status(400).json({ error: 'Missing employeeId, pin or action' });
  if (!['in', 'out'].includes(action)) return res.status(400).json({ error: 'Action must be in or out' });

  const employees = readJson(EMPLOYEES_FILE, []);
  const sites = readJson(SITES_FILE, []);
  const logs = readJson(LOGS_FILE, []);
  const employee = employees.find(e => e.id === employeeId);
  if (!employee) {
    recordFailedAttempt({ employeeId, action, reason: 'Employee not found', lat: lat ?? null, lng: lng ?? null });
    return res.status(404).json({ error: 'Employee not found' });
  }
  if (String(employee.pin) !== String(pin)) {
    recordFailedAttempt({ employeeId, name: employee.name, action, reason: 'Invalid PIN', lat: lat ?? null, lng: lng ?? null });
    return res.status(401).json({ error: 'Invalid PIN' });
  }
  if (employee.mustClock === false) {
    return res.status(400).json({ error: 'This profile does not need clock in/out' });
  }

  const state = getEmployeeCurrentState(employee.id, logs);
  if (action === 'in' && state.currentlyClockedIn) return res.status(400).json({ error: 'Already clocked in' });
  if (action === 'out' && !state.currentlyClockedIn) return res.status(400).json({ error: 'Clock in first' });

  const site = sites.find(s => s.id === employee.siteId);
  let geo = { required: Boolean(employee.geoRequired), allowed: true, distanceMeters: null, siteName: site?.name || employee.site };
  if (employee.geoRequired) {
    if (lat === undefined || lng === undefined || !site) {
      recordFailedAttempt({ employeeId, name: employee.name, action, reason: 'Missing location', site: employee.site });
      return res.status(400).json({ error: 'Location is required for this employee' });
    }
    const distance = haversineMeters(Number(lat), Number(lng), Number(site.lat), Number(site.lng));
    geo.distanceMeters = Math.round(distance);
    geo.allowed = distance <= Number(site.radiusMeters || 200);
    if (!geo.allowed) {
      recordFailedAttempt({ employeeId, name: employee.name, action, reason: 'Outside allowed area', distanceMeters: geo.distanceMeters, site: employee.site, lat: Number(lat), lng: Number(lng) });
      return res.status(403).json({ error: `Outside allowed area. Distance: ${geo.distanceMeters}m. Limit: ${site.radiusMeters}m` });
    }
  }

  const entry = buildLogEntry({ employee, action, timeISO: new Date().toISOString(), lat: lat ?? null, lng: lng ?? null, geo, source: 'mobile' });
  logs.push(entry);
  writeJson(LOGS_FILE, logs);
  const nextState = getEmployeeCurrentState(employee.id, logs);
  res.json({ success: true, message: `${employee.name} clocked ${action}`, entry, state: nextState });
});

app.get('/api/logs', adminOnly, (req, res) => {
  const all = readJson(LOGS_FILE, []).sort((a, b) => new Date(b.time) - new Date(a.time));
  const { items, pagination } = paginate(all, req.query.page, 20);
  res.json({ items, pagination });
});
app.get('/api/failed-attempts', adminOnly, (req, res) => {
  const all = readJson(FAILED_FILE, []).sort((a, b) => new Date(b.time) - new Date(a.time));
  const { items, pagination } = paginate(all, req.query.page, 20);
  res.json({ items, pagination });
});

app.post('/api/manual-log', adminOnly, (req, res) => {
  const { employeeId, action, date, time, notes } = req.body || {};
  if (!employeeId || !action || !date || !time) return res.status(400).json({ error: 'Missing employeeId, action, date or time' });
  const employees = readJson(EMPLOYEES_FILE, []);
  const logs = readJson(LOGS_FILE, []);
  const employee = employees.find(e => e.id === employeeId);
  if (!employee) return res.status(404).json({ error: 'Employee not found' });
  const entry = buildLogEntry({ employee, action, timeISO: new Date(`${date}T${time}:00`).toISOString(), lat: null, lng: null, geo: { required: false, allowed: true, distanceMeters: null, siteName: employee.site }, source: 'manual', notes: notes || '' });
  logs.push(entry);
  writeJson(LOGS_FILE, logs);
  res.json({ success: true, entry });
});
app.put('/api/logs/:id', adminOnly, (req, res) => {
  const logs = readJson(LOGS_FILE, []);
  const idx = logs.findIndex(l => l.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Log not found' });
  const current = logs[idx];
  const body = req.body || {};
  const timeISO = body.date && body.time ? new Date(`${body.date}T${body.time}:00`).toISOString() : current.time;
  logs[idx] = { ...current, action: body.action || current.action, notes: body.notes ?? current.notes, time: timeISO, localTime: formatLondon(timeISO) };
  writeJson(LOGS_FILE, logs);
  res.json({ success: true, entry: logs[idx] });
});
app.delete('/api/logs/:id', adminOnly, (req, res) => {
  let logs = readJson(LOGS_FILE, []);
  const before = logs.length;
  logs = logs.filter(l => l.id !== req.params.id);
  if (logs.length === before) return res.status(404).json({ error: 'Log not found' });
  writeJson(LOGS_FILE, logs);
  res.json({ success: true });
});

app.get('/api/dashboard/today', adminOnly, (req, res) => {
  const employees = readJson(EMPLOYEES_FILE, []);
  const logs = readJson(LOGS_FILE, []);
  const { start, end } = startEndOfDayLondon(req.query.date);
  const todayLogs = logs.filter(l => { const t = new Date(l.time); return t >= start && t < end; }).sort((a, b) => new Date(a.time) - new Date(b.time));
  const employeeSummaries = employees.map(emp => {
    const mine = todayLogs.filter(l => l.employeeId === emp.id);
    let openIn = null, totalMs = 0, firstIn = '', lastOut = '';
    for (const log of mine) {
      if (log.action === 'in') { openIn = log; if (!firstIn) firstIn = log.time; }
      else if (log.action === 'out') { if (openIn) { totalMs += new Date(log.time) - new Date(openIn.time); openIn = null; } lastOut = log.time; }
    }
    return { employeeId: emp.id, name: emp.name, site: emp.site, todayHours: Number((totalMs / 36e5).toFixed(2)), currentlyClockedIn: Boolean(openIn), firstIn: firstIn ? formatLondon(firstIn) : '', lastOut: lastOut ? formatLondon(lastOut) : '' };
  });
  res.json({ date: dateLondon(new Date()), employees: employeeSummaries });
});

app.get('/api/map/logs', adminOnly, (req, res) => {
  const logs = readJson(LOGS_FILE, []);
  const failed = readJson(FAILED_FILE, []);
  const successful = logs.filter(l => l.lat !== null && l.lng !== null).map(l => ({ type: 'success', id: l.id, name: l.name, site: l.site, action: l.action, time: l.time, localTime: l.localTime, lat: l.lat, lng: l.lng }));
  const unsuccessful = failed.filter(l => l.lat != null && l.lng != null).map(l => ({ type: 'failed', id: l.id, name: l.name || 'Unknown', site: l.site || '', action: l.action || '', reason: l.reason || '', time: l.time, localTime: l.localTime, lat: l.lat, lng: l.lng }));
  res.json([...successful, ...unsuccessful]);
});

app.get('/api/reports/weekly', adminOnly, (req, res) => {
  const employees = readJson(EMPLOYEES_FILE, []);
  const logs = readJson(LOGS_FILE, []);
  const { monday, sunday } = weekRangeMondayToSunday(new Date());
  let report = employees.map(emp => compensationSummaryForEmployee(emp, logs, monday, sunday));
  if (req.query.site) report = report.filter(r => r.site === req.query.site);
  res.json({ weekStart: monday.toISOString(), weekEnd: sunday.toISOString(), report });
});
app.get('/api/reports/weekly/excel', adminOnly, async (req, res) => {
  const employees = readJson(EMPLOYEES_FILE, []);
  const logs = readJson(LOGS_FILE, []);
  const { monday, sunday } = weekRangeMondayToSunday(new Date());
  const siteFilter = req.query.site || '';
  const workbook = new ExcelJS.Workbook();
  const ws = workbook.addWorksheet('Payroll');
  ws.columns = [
    { header: 'Name', key: 'name', width: 22 },
    { header: 'Site', key: 'site', width: 22 },
    { header: 'Date', key: 'date', width: 14 },
    { header: 'Clock in time', key: 'clockInTime', width: 16 },
    { header: 'Clock out time', key: 'clockOutTime', width: 16 },
    { header: 'Total hours', key: 'totalHours', width: 14 },
    { header: 'Hourly rate', key: 'hourlyRate', width: 14 },
    { header: 'Total pay', key: 'totalPay', width: 14 }
  ];
  employees.forEach(emp => {
    if (siteFilter && emp.site !== siteFilter) return;
    dailyRowsForEmployee(emp, logs, monday, sunday).forEach(r => ws.addRow(r));
  });
  ws.getRow(1).font = { bold: true };
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="payroll-${siteFilter || 'all-sites'}-${dateLondon(new Date())}.xlsx"`);
  await workbook.xlsx.write(res);
  res.end();
});
app.get('/api/reports/weekly/pdf', adminOnly, (req, res) => {
  const employees = readJson(EMPLOYEES_FILE, []);
  const logs = readJson(LOGS_FILE, []);
  const { monday, sunday } = weekRangeMondayToSunday(new Date());
  const siteFilter = req.query.site || '';
  const report = employees.filter(emp => !siteFilter || emp.site === siteFilter).map(emp => compensationSummaryForEmployee(emp, logs, monday, sunday));
  const doc = new PDFDocument({ margin: 40, size: 'A4' });
  const filename = `payroll-${siteFilter || 'all-sites'}-${dateLondon(new Date())}.pdf`;
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  doc.pipe(res);
  doc.fontSize(18).text('ClockFlow Weekly Payroll', { align: 'center' });
  doc.moveDown(0.5).fontSize(11).text(`Site: ${siteFilter || 'All sites'}`).text(`Week: ${dateLondon(monday)} to ${dateLondon(sunday)}`);
  doc.moveDown();
  report.forEach(row => {
    doc.fontSize(12).text(`${row.name} — ${row.site}`, { underline: true });
    doc.fontSize(10).text(`Hours: ${row.totalHoursRaw.toFixed(2)} | Paid: ${row.paidHours.toFixed(2)} | Rate: £${Number(row.compensationRate).toFixed(2)} (${row.compensationType}) | Advance: £${Number(row.advanceBalance).toFixed(2)} | Total pay: £${row.totalPay.toFixed(2)}`);
    doc.text(`Lunch: ${row.lunchMinutes} min | Days worked: ${row.daysWorked}`);
    doc.moveDown(0.8);
  });
  doc.end();
});

app.get('/api/admin/backup/download', adminOnly, (req, res) => {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  res.setHeader('Content-Type', 'application/gzip');
  res.setHeader('Content-Disposition', `attachment; filename="clockflow-backup-${stamp}.tgz"`);
  const tar = spawn('tar', ['-czf', '-', '-C', DATA_DIR, '.']);
  tar.stdout.pipe(res);
  tar.stderr.on('data', () => {});
  tar.on('error', err => {
    if (!res.headersSent) res.status(500).json({ error: err.message });
  });
});

app.listen(PORT, '0.0.0.0', () => console.log(`ClockFlow running on 0.0.0.0:${PORT}`));
