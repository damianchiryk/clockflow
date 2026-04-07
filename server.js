const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const ExcelJS = require('exceljs');
const PDFDocument = require('pdfkit');

const app = express();
const PORT = process.env.PORT || 3000;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123';
const LONDON_TZ = 'Europe/London';

app.use(express.json({ limit: '35mb' }));
app.use(express.static(path.join(__dirname, 'public')));

const DATA_DIR = path.join(__dirname, 'data');
const EMPLOYEES_FILE = path.join(DATA_DIR, 'employees.json');
const LOGS_FILE = path.join(DATA_DIR, 'logs.json');
const SITES_FILE = path.join(DATA_DIR, 'sites.json');
const FAILED_FILE = path.join(DATA_DIR, 'failed_attempts.json');
const UPLOADS_DIR = path.join(DATA_DIR, 'uploads');

const adminSessions = new Map();

function ensureDir(dir = DATA_DIR) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}
function ensureFile(file, fallback) {
  ensureDir();
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
function token() {
  return crypto.randomBytes(24).toString('hex');
}
function slugify(v = '') {
  return String(v).toLowerCase().trim().replace(/[^a-z0-9]+/g, '.').replace(/^\.+|\.+$/g, '');
}
function toNumber(v, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}
function sanitizeText(v = '') {
  return String(v).trim();
}
function safeFilePart(v = '') {
  return String(v).replace(/[^a-zA-Z0-9._-]/g, '_');
}

function getFormatter(timeZone, opts = {}) {
  return new Intl.DateTimeFormat('en-GB', { timeZone, ...opts });
}
function formatParts(date, timeZone = LONDON_TZ) {
  const parts = getFormatter(timeZone, {
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    weekday: 'short', hourCycle: 'h23'
  }).formatToParts(new Date(date));
  const out = {};
  for (const p of parts) if (p.type !== 'literal') out[p.type] = p.value;
  return out;
}
function getTimeZoneOffsetMinutes(date, timeZone = LONDON_TZ) {
  const p = formatParts(date, timeZone);
  const asUtc = Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), Number(p.hour), Number(p.minute), Number(p.second));
  return (asUtc - new Date(date).getTime()) / 60000;
}
function londonDateTimeToUTC(dateStr, timeStr = '00:00:00') {
  const [year, month, day] = String(dateStr).split('-').map(Number);
  const [hour, minute, second] = String(timeStr).split(':').map(v => Number(v || 0));
  const utcGuess = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
  const offset = getTimeZoneOffsetMinutes(utcGuess, LONDON_TZ);
  return new Date(utcGuess.getTime() - offset * 60000);
}
function formatLondon(date) {
  return new Date(date).toLocaleString('en-GB', {
    timeZone: LONDON_TZ,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit'
  });
}
function dateLondon(date) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: LONDON_TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(date));
}
function timeLondon(date) {
  return new Intl.DateTimeFormat('en-GB', { timeZone: LONDON_TZ, hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).format(new Date(date));
}
function nowLondonDate() {
  return dateLondon(new Date());
}
function startEndOfDayLondon(dateStr) {
  const base = dateStr || nowLondonDate();
  const start = londonDateTimeToUTC(base, '00:00:00');
  const end = londonDateTimeToUTC(base, '23:59:59');
  end.setMilliseconds(999);
  return { start, endExclusive: new Date(end.getTime() + 1), end };
}
function weekRangeMondayToSunday(inputDate = new Date()) {
  const p = formatParts(inputDate, LONDON_TZ);
  const dayMap = { Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6 };
  const idx = dayMap[p.weekday] ?? 0;
  const currentLondonMidday = londonDateTimeToUTC(`${p.year}-${p.month}-${p.day}`, '12:00:00');
  const mondayMidday = new Date(currentLondonMidday);
  mondayMidday.setUTCDate(mondayMidday.getUTCDate() - idx);
  const mondayDate = dateLondon(mondayMidday);
  const monday = londonDateTimeToUTC(mondayDate, '00:00:00');
  const sunday = londonDateTimeToUTC(dateLondon(new Date(monday.getTime() + 6 * 86400000)), '23:59:59');
  sunday.setMilliseconds(999);
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

function sessionFromReq(req) {
  return req.headers['x-admin-token'] || req.query.adminToken || req.query.token;
}
function adminOnly(req, res, next) {
  const password = req.headers['x-admin-password'] || req.query.adminPassword || req.query.password;
  const adminToken = sessionFromReq(req);
  if (adminToken && adminSessions.has(String(adminToken))) return next();
  if (String(password || '') === String(ADMIN_PASSWORD)) return next();
  return res.status(401).json({ error: 'Unauthorized' });
}
function publicEmployee(employee) {
  const { pin, ...rest } = employee;
  return {
    ...rest,
    login: rest.login || slugify(rest.name),
    mustChangePin: Boolean(rest.mustChangePin),
    documents: Array.isArray(rest.documents) ? rest.documents : []
  };
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
function getEmployeeLogin(employee) {
  return sanitizeText(employee.login || slugify(employee.name));
}
function findEmployeeByLogin(employees, loginOrId) {
  const lookup = sanitizeText(loginOrId).toLowerCase();
  return employees.find(e =>
    String(e.id).toLowerCase() === lookup ||
    getEmployeeLogin(e).toLowerCase() === lookup ||
    sanitizeText(e.name).toLowerCase() === lookup
  );
}
function buildWorkPairs(employee, logs, rangeStart, rangeEnd) {
  const mine = logs
    .filter(l => l.employeeId === employee.id)
    .filter(l => {
      const t = new Date(l.time);
      return t >= rangeStart && t <= rangeEnd;
    })
    .sort((a, b) => new Date(a.time) - new Date(b.time));

  let openIn = null;
  const rows = [];
  for (const log of mine) {
    if (log.action === 'in') {
      openIn = log;
    } else if (log.action === 'out' && openIn) {
      const start = new Date(openIn.time);
      const end = new Date(log.time);
      const ms = Math.max(0, end - start);
      rows.push({ in: openIn, out: log, ms });
      openIn = null;
    }
  }
  return rows;
}
function compensationSummaryForEmployee(employee, logs, weekStart, weekEnd) {
  const pairs = buildWorkPairs(employee, logs, weekStart, weekEnd);
  const totalMs = pairs.reduce((sum, row) => sum + row.ms, 0);
  const totalHoursRaw = totalMs / 36e5;
  const lunchHours = (toNumber(employee.lunchMinutes, 0) / 60) * pairs.length;
  const paidHours = Math.max(0, totalHoursRaw - lunchHours);
  const compensationType = employee.compensationType || 'hourly';
  const compensationRate = toNumber(employee.compensationRate ?? employee.hourlyRate ?? 0, 0);
  const mustClock = employee.mustClock !== false;
  let grossPay = 0;

  if (compensationType === 'hourly') {
    grossPay = paidHours * compensationRate;
  } else if (compensationType === 'daily') {
    grossPay = pairs.length * compensationRate;
  } else if (compensationType === 'weekly') {
    grossPay = mustClock ? (pairs.length > 0 ? compensationRate : 0) : compensationRate;
  } else if (compensationType === 'monthly') {
    grossPay = compensationRate * 12 / 52;
  }

  const advanceDeduction = toNumber(employee.advanceBalance, 0);
  const totalPay = Math.max(0, grossPay - advanceDeduction);

  return {
    employeeId: employee.id,
    name: employee.name,
    login: getEmployeeLogin(employee),
    site: employee.site,
    compensationType,
    compensationRate,
    lunchMinutes: toNumber(employee.lunchMinutes, 0),
    daysWorked: pairs.length,
    totalHoursRaw: Number(totalHoursRaw.toFixed(2)),
    paidHours: Number(paidHours.toFixed(2)),
    grossPay: Number(grossPay.toFixed(2)),
    advanceDeduction: Number(advanceDeduction.toFixed(2)),
    totalPay: Number(totalPay.toFixed(2)),
    mustClock,
    pairs
  };
}
function dailyRowsForEmployee(employee, logs, weekStart, weekEnd) {
  const pairs = buildWorkPairs(employee, logs, weekStart, weekEnd);
  const rate = toNumber(employee.compensationRate ?? employee.hourlyRate ?? 0, 0);
  const compensationType = employee.compensationType || 'hourly';
  const weeklyEquivalent = compensationType === 'monthly' ? rate * 12 / 52 : rate;
  return pairs.map((row, i) => {
    const hours = row.ms / 36e5;
    const paidHours = Math.max(0, hours - toNumber(employee.lunchMinutes, 0) / 60);
    let totalPay = 0;
    if (compensationType === 'hourly') totalPay = paidHours * rate;
    else if (compensationType === 'daily') totalPay = rate;
    else if (compensationType === 'weekly') totalPay = i === 0 ? rate : 0;
    else if (compensationType === 'monthly') totalPay = i === 0 ? weeklyEquivalent : 0;
    return {
      name: employee.name,
      site: employee.site,
      type: compensationType,
      date: dateLondon(row.in.time),
      clockInTime: timeLondon(row.in.time),
      clockOutTime: timeLondon(row.out.time),
      totalHours: Number(hours.toFixed(2)),
      paidHours: Number(paidHours.toFixed(2)),
      rate: rate,
      totalPay: Number(totalPay.toFixed(2))
    };
  });
}
function ensureSeed() {
  ensureFile(SITES_FILE, [
    { id: 'vrs-east-tilbury', name: 'VRS Bodyshop', address: '91a, Thames Industrial Park, East Tilbury, Tilbury RM18 8RH', lat: 51.47873004008197, lng: 0.4137913929600394, radiusMeters: 200 },
    { id: 'alk-grays', name: 'ALK Bodyshop', address: 'Unit 7, Cliffside Estate, Grays RM17 5XR', lat: 51.4838239, lng: 0.3094763, radiusMeters: 200 }
  ]);
  ensureFile(EMPLOYEES_FILE, [
    { id: 'damian', name: 'Damian', login: 'damian', pin: '1234', site: 'VRS Mechanical', siteId: 'vrs-east-tilbury', hourlyRate: 0, compensationType: 'hourly', compensationRate: 0, lunchMinutes: 0, geoRequired: false, isAdmin: true, mustClock: true, mustChangePin: false, advanceBalance: 0, documents: [] }
  ]);
  ensureFile(LOGS_FILE, []);
  ensureFile(FAILED_FILE, []);
  ensureDir(UPLOADS_DIR);

  const sites = readJson(SITES_FILE, []);
  let changedSites = false;
  const requiredSites = [
    { id: 'vrs-mechanical', name: 'VRS Mechanical', address: '91a, Thames Industrial Park, East Tilbury, Tilbury RM18 8RH', lat: 51.47873004008197, lng: 0.4137913929600394, radiusMeters: 200 },
    { id: 'vrs-east-tilbury', name: 'VRS Bodyshop', address: '91a, Thames Industrial Park, East Tilbury, Tilbury RM18 8RH', lat: 51.47873004008197, lng: 0.4137913929600394, radiusMeters: 200 },
    { id: 'alk-grays', name: 'ALK Bodyshop', address: 'Unit 7, Cliffside Estate, Grays RM17 5XR', lat: 51.4838239, lng: 0.3094763, radiusMeters: 200 }
  ];
  requiredSites.forEach(required => {
    const existing = sites.find(s => s.id === required.id || s.name === required.name);
    if (!existing) { sites.push(required); changedSites = true; return; }
    if (!existing.address && required.address) { existing.address = required.address; changedSites = true; }
    if ((!existing.lat && required.lat) || (!existing.lng && required.lng)) {
      existing.lat = required.lat; existing.lng = required.lng; changedSites = true;
    }
    if (!existing.radiusMeters) { existing.radiusMeters = required.radiusMeters; changedSites = true; }
    if (!existing.id) { existing.id = required.id; changedSites = true; }
    if (!existing.name) { existing.name = required.name; changedSites = true; }
  });
  sites.forEach(site => {
    if (site.address === undefined) { site.address = ''; changedSites = true; }
    site.lat = toNumber(site.lat, 0);
    site.lng = toNumber(site.lng, 0);
    site.radiusMeters = toNumber(site.radiusMeters, 200);
  });
  if (changedSites) writeJson(SITES_FILE, sites);

  const employees = readJson(EMPLOYEES_FILE, []);
  let changedEmployees = false;
  employees.forEach(e => {
    if (!e.login) { e.login = slugify(e.name); changedEmployees = true; }
    if (!e.compensationType) { e.compensationType = 'hourly'; changedEmployees = true; }
    if (e.compensationRate === undefined) { e.compensationRate = toNumber(e.hourlyRate, 0); changedEmployees = true; }
    if (e.mustClock === undefined) { e.mustClock = true; changedEmployees = true; }
    if (e.mustChangePin === undefined) { e.mustChangePin = false; changedEmployees = true; }
    if (e.advanceBalance === undefined) { e.advanceBalance = 0; changedEmployees = true; }
    if (!Array.isArray(e.documents)) { e.documents = []; changedEmployees = true; }
  });
  if (changedEmployees) writeJson(EMPLOYEES_FILE, employees);
}
ensureSeed();

function recordFailedAttempt(payload) {
  const failed = readJson(FAILED_FILE, []);
  failed.push({ id: uid(), time: new Date().toISOString(), localTime: formatLondon(new Date()), ...payload });
  writeJson(FAILED_FILE, failed);
}
function requireClockCheck(employee, action) {
  if (employee.mustClock === false) {
    return `${employee.name} does not need to clock ${action}.`;
  }
  return null;
}

app.get('/', (req, res) => res.redirect('/mobile.html'));
app.get('/admin', (req, res) => res.redirect('/admin.html'));
app.get('/health', (req, res) => res.status(200).send('OK'));

app.post('/api/admin-login', (req, res) => {
  const { password } = req.body || {};
  if (String(password || '') !== String(ADMIN_PASSWORD)) return res.status(401).json({ error: 'Invalid admin password' });
  const adminToken = token();
  adminSessions.set(adminToken, { createdAt: Date.now() });
  res.json({ success: true, token: adminToken });
});

app.get('/api/sites', adminOnly, (req, res) => res.json(readJson(SITES_FILE, [])));

app.get('/api/employees', (req, res) => {
  const employees = readJson(EMPLOYEES_FILE, []);
  res.json(employees.map(publicEmployee));
});

app.post('/api/employees', adminOnly, (req, res) => {
  const employees = readJson(EMPLOYEES_FILE, []);
  const body = req.body || {};
  if (!body.name || !body.pin || !body.site || !body.siteId) return res.status(400).json({ error: 'Missing required fields' });

  const login = sanitizeText(body.login || slugify(body.name));
  if (employees.some(e => getEmployeeLogin(e).toLowerCase() === login.toLowerCase())) {
    return res.status(400).json({ error: 'Login already exists' });
  }

  const employee = {
    id: uid(),
    name: sanitizeText(body.name),
    login,
    pin: sanitizeText(body.pin),
    site: sanitizeText(body.site),
    siteId: sanitizeText(body.siteId),
    hourlyRate: toNumber(body.hourlyRate, 0),
    compensationType: sanitizeText(body.compensationType || 'hourly'),
    compensationRate: toNumber(body.compensationRate ?? body.hourlyRate, 0),
    lunchMinutes: toNumber(body.lunchMinutes, 0),
    geoRequired: Boolean(body.geoRequired),
    isAdmin: Boolean(body.isAdmin),
    mustClock: body.mustClock === undefined ? true : Boolean(body.mustClock),
    mustChangePin: body.mustChangePin === undefined ? true : Boolean(body.mustChangePin),
    advanceBalance: toNumber(body.advanceBalance, 0),
    documents: []
  };

  employees.push(employee);
  writeJson(EMPLOYEES_FILE, employees);
  res.json({ success: true, employee: publicEmployee(employee) });
});

app.put('/api/employees/:id', adminOnly, (req, res) => {
  const employees = readJson(EMPLOYEES_FILE, []);
  const idx = employees.findIndex(e => e.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Employee not found' });
  const current = employees[idx];
  const body = req.body || {};
  const nextLogin = sanitizeText(body.login !== undefined ? body.login : getEmployeeLogin(current));
  if (employees.some((e, i) => i !== idx && getEmployeeLogin(e).toLowerCase() === nextLogin.toLowerCase())) {
    return res.status(400).json({ error: 'Login already exists' });
  }
  const next = {
    ...current,
    ...body,
    name: body.name !== undefined ? sanitizeText(body.name) : current.name,
    login: nextLogin,
    pin: body.pin !== undefined && String(body.pin).trim() !== '' ? sanitizeText(body.pin) : current.pin,
    site: body.site !== undefined ? sanitizeText(body.site) : current.site,
    siteId: body.siteId !== undefined ? sanitizeText(body.siteId) : current.siteId,
    hourlyRate: toNumber(body.hourlyRate ?? current.hourlyRate, current.hourlyRate),
    compensationType: sanitizeText(body.compensationType ?? current.compensationType ?? 'hourly'),
    compensationRate: toNumber(body.compensationRate ?? body.hourlyRate ?? current.compensationRate ?? current.hourlyRate, current.compensationRate ?? current.hourlyRate),
    lunchMinutes: toNumber(body.lunchMinutes ?? current.lunchMinutes, current.lunchMinutes),
    geoRequired: body.geoRequired === undefined ? current.geoRequired : Boolean(body.geoRequired),
    isAdmin: body.isAdmin === undefined ? current.isAdmin : Boolean(body.isAdmin),
    mustClock: body.mustClock === undefined ? current.mustClock !== false : Boolean(body.mustClock),
    mustChangePin: body.mustChangePin === undefined ? current.mustChangePin : Boolean(body.mustChangePin),
    advanceBalance: toNumber(body.advanceBalance ?? current.advanceBalance, current.advanceBalance),
    documents: Array.isArray(current.documents) ? current.documents : []
  };
  employees[idx] = next;
  writeJson(EMPLOYEES_FILE, employees);
  res.json({ success: true, employee: publicEmployee(next) });
});

app.delete('/api/employees/:id', adminOnly, (req, res) => {
  let employees = readJson(EMPLOYEES_FILE, []);
  const before = employees.length;
  employees = employees.filter(e => e.id !== req.params.id);
  if (employees.length === before) return res.status(404).json({ error: 'Employee not found' });
  writeJson(EMPLOYEES_FILE, employees);
  res.json({ success: true });
});

app.post('/api/mobile-auth', (req, res) => {
  const { login, pin } = req.body || {};
  const employees = readJson(EMPLOYEES_FILE, []);
  const employee = findEmployeeByLogin(employees, login);
  if (!employee) return res.status(404).json({ error: 'Employee not found' });
  if (String(employee.pin) !== String(pin || '')) {
    recordFailedAttempt({ employeeId: employee.id, name: employee.name, reason: 'Invalid PIN', action: 'login' });
    return res.status(401).json({ error: 'Invalid PIN' });
  }
  res.json({ success: true, employee: publicEmployee(employee) });
});

app.post('/api/mobile/change-pin', (req, res) => {
  const { login, currentPin, newPin } = req.body || {};
  if (!newPin || String(newPin).trim().length < 4) return res.status(400).json({ error: 'New PIN must be at least 4 characters' });
  const employees = readJson(EMPLOYEES_FILE, []);
  const idx = employees.findIndex(e => {
    const match = findEmployeeByLogin([e], login);
    return Boolean(match);
  });
  if (idx === -1) return res.status(404).json({ error: 'Employee not found' });
  const employee = employees[idx];
  if (String(employee.pin) !== String(currentPin || '')) return res.status(401).json({ error: 'Current PIN is invalid' });
  employees[idx] = { ...employee, pin: String(newPin).trim(), mustChangePin: false };
  writeJson(EMPLOYEES_FILE, employees);
  res.json({ success: true, employee: publicEmployee(employees[idx]) });
});

app.post('/api/mobile/upload-document', (req, res) => {
  const { login, pin, docType, fileName, mimeType, base64 } = req.body || {};
  const employees = readJson(EMPLOYEES_FILE, []);
  const idx = employees.findIndex(e => {
    const match = findEmployeeByLogin([e], login);
    return Boolean(match);
  });
  if (idx === -1) return res.status(404).json({ error: 'Employee not found' });
  const employee = employees[idx];
  if (String(employee.pin) !== String(pin || '')) return res.status(401).json({ error: 'Invalid PIN' });
  if (!base64 || !fileName) return res.status(400).json({ error: 'Missing file data' });
  const cleanBase64 = String(base64).includes(',') ? String(base64).split(',').pop() : String(base64);

  const ext = path.extname(fileName) || '';
  const finalName = `${safeFilePart(employee.id)}-${Date.now()}-${safeFilePart(docType || 'document')}${ext}`;
  const employeeDir = path.join(UPLOADS_DIR, safeFilePart(employee.id));
  ensureDir(employeeDir);
  fs.writeFileSync(path.join(employeeDir, finalName), Buffer.from(cleanBase64, 'base64'));

  const doc = {
    id: uid(),
    docType: sanitizeText(docType || 'document'),
    fileName: sanitizeText(fileName),
    storedAs: finalName,
    mimeType: sanitizeText(mimeType || 'application/octet-stream'),
    uploadedAt: new Date().toISOString(),
    uploadedAtLocal: formatLondon(new Date())
  };
  const documents = Array.isArray(employee.documents) ? employee.documents : [];
  employees[idx] = { ...employee, documents: [doc, ...documents] };
  writeJson(EMPLOYEES_FILE, employees);
  res.json({ success: true, documents: employees[idx].documents });
});

app.get('/api/employee-documents/:employeeId', adminOnly, (req, res) => {
  const employees = readJson(EMPLOYEES_FILE, []);
  const employee = employees.find(e => e.id === req.params.employeeId);
  if (!employee) return res.status(404).json({ error: 'Employee not found' });
  res.json({ employee: publicEmployee(employee), documents: employee.documents || [] });
});

app.get('/api/employee-document/:employeeId/:docId', adminOnly, (req, res) => {
  const employees = readJson(EMPLOYEES_FILE, []);
  const employee = employees.find(e => e.id === req.params.employeeId);
  if (!employee) return res.status(404).json({ error: 'Employee not found' });
  const doc = (employee.documents || []).find(d => d.id === req.params.docId);
  if (!doc) return res.status(404).json({ error: 'Document not found' });
  const filePath = path.join(UPLOADS_DIR, safeFilePart(employee.id), doc.storedAs);
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'Stored file not found' });
  res.setHeader('Content-Type', doc.mimeType || 'application/octet-stream');
  res.setHeader('Content-Disposition', `inline; filename="${safeFilePart(doc.fileName)}"`);
  fs.createReadStream(filePath).pipe(res);
});

app.post('/api/clock', (req, res) => {
  const { employeeId, login, pin, action, lat, lng } = req.body || {};
  if ((!employeeId && !login) || !pin || !action) return res.status(400).json({ error: 'Missing login/employeeId, pin or action' });
  if (!['in', 'out'].includes(action)) return res.status(400).json({ error: 'Action must be in or out' });

  const employees = readJson(EMPLOYEES_FILE, []);
  const sites = readJson(SITES_FILE, []);
  const logs = readJson(LOGS_FILE, []);
  const employee = employeeId ? employees.find(e => e.id === employeeId) : findEmployeeByLogin(employees, login);
  if (!employee) {
    recordFailedAttempt({ employeeId: employeeId || null, action, reason: 'Employee not found', lat: lat ?? null, lng: lng ?? null });
    return res.status(404).json({ error: 'Employee not found' });
  }
  if (String(employee.pin) !== String(pin)) {
    recordFailedAttempt({ employeeId: employee.id, name: employee.name, action, reason: 'Invalid PIN', lat: lat ?? null, lng: lng ?? null });
    return res.status(401).json({ error: 'Invalid PIN' });
  }
  if (employee.mustChangePin) {
    return res.status(403).json({ error: 'PIN change required before clocking', mustChangePin: true });
  }
  const noClockReason = requireClockCheck(employee, action);
  if (noClockReason) {
    return res.status(400).json({ error: noClockReason, mustClock: false });
  }

  const site = sites.find(s => s.id === employee.siteId);
  const geo = { required: Boolean(employee.geoRequired), allowed: true, distanceMeters: null, siteName: site?.name || employee.site };
  if (employee.geoRequired) {
    if (lat === undefined || lng === undefined || !site) {
      recordFailedAttempt({ employeeId: employee.id, name: employee.name, action, reason: 'Missing location', site: employee.site });
      return res.status(400).json({ error: 'Location is required for this employee' });
    }
    const distance = haversineMeters(Number(lat), Number(lng), Number(site.lat), Number(site.lng));
    geo.distanceMeters = Math.round(distance);
    geo.allowed = distance <= Number(site.radiusMeters || 200);
    if (!geo.allowed) {
      recordFailedAttempt({ employeeId: employee.id, name: employee.name, action, reason: 'Outside allowed area', distanceMeters: geo.distanceMeters, site: employee.site, lat: Number(lat), lng: Number(lng) });
      return res.status(403).json({ error: `Outside allowed area. Distance: ${geo.distanceMeters}m. Limit: ${site.radiusMeters}m` });
    }
  }

  const now = new Date();
  const entry = buildLogEntry({ employee, action, timeISO: now.toISOString(), lat: lat ?? null, lng: lng ?? null, geo, source: 'mobile' });
  logs.push(entry);
  writeJson(LOGS_FILE, logs);
  res.json({ success: true, message: `${employee.name} clocked ${action}`, entry, employee: publicEmployee(employee) });
});

app.get('/api/logs', adminOnly, (req, res) => {
  const logs = readJson(LOGS_FILE, []);
  res.json([...logs].sort((a, b) => new Date(b.time) - new Date(a.time)));
});
app.get('/api/failed-attempts', adminOnly, (req, res) => {
  const failed = readJson(FAILED_FILE, []);
  res.json([...failed].sort((a, b) => new Date(b.time) - new Date(a.time)));
});

app.post('/api/manual-log', adminOnly, (req, res) => {
  const { employeeId, action, date, time, notes } = req.body || {};
  if (!employeeId || !action || !date || !time) return res.status(400).json({ error: 'Missing employeeId, action, date or time' });
  const employees = readJson(EMPLOYEES_FILE, []);
  const logs = readJson(LOGS_FILE, []);
  const employee = employees.find(e => e.id === employeeId);
  if (!employee) return res.status(404).json({ error: 'Employee not found' });
  const iso = londonDateTimeToUTC(date, `${time}:00`).toISOString();
  const entry = buildLogEntry({
    employee, action, timeISO: iso, lat: null, lng: null,
    geo: { required: false, allowed: true, distanceMeters: null, siteName: employee.site },
    source: 'manual', notes: notes || ''
  });
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
  let timeISO = current.time;
  if (body.date && body.time) timeISO = londonDateTimeToUTC(body.date, `${body.time}:00`).toISOString();
  const next = { ...current, action: body.action || current.action, notes: body.notes !== undefined ? body.notes : current.notes, time: timeISO, localTime: formatLondon(timeISO) };
  logs[idx] = next;
  writeJson(LOGS_FILE, logs);
  res.json({ success: true, entry: next });
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
  const { start, endExclusive } = startEndOfDayLondon(req.query.date);
  const todayLogs = logs.filter(l => {
    const t = new Date(l.time);
    return t >= start && t < endExclusive;
  }).sort((a, b) => new Date(a.time) - new Date(b.time));

  const employeeSummaries = employees.map(emp => {
    const mine = todayLogs.filter(l => l.employeeId === emp.id);
    let openIn = null, totalMs = 0, firstIn = '', lastOut = '';
    for (const log of mine) {
      if (log.action === 'in') {
        openIn = log;
        if (!firstIn) firstIn = log.time;
      } else if (log.action === 'out') {
        if (openIn) {
          totalMs += new Date(log.time) - new Date(openIn.time);
          openIn = null;
        }
        lastOut = log.time;
      }
    }
    return {
      employeeId: emp.id,
      name: emp.name,
      site: emp.site,
      todayHours: Number((totalMs / 36e5).toFixed(2)),
      currentlyClockedIn: Boolean(openIn),
      firstIn: firstIn ? formatLondon(firstIn) : '',
      lastOut: lastOut ? formatLondon(lastOut) : '',
      mustClock: emp.mustClock !== false
    };
  });

  res.json({ date: dateLondon(new Date()), employees: employeeSummaries });
});

app.get('/api/map/logs', adminOnly, (req, res) => {
  const logs = readJson(LOGS_FILE, []);
  const failed = readJson(FAILED_FILE, []);
  const successful = logs
    .filter(l => l.lat !== null && l.lng !== null && Number.isFinite(Number(l.lat)) && Number.isFinite(Number(l.lng)))
    .map(l => ({ type: 'success', id: l.id, name: l.name, site: l.site, action: l.action, time: l.time, localTime: l.localTime, lat: Number(l.lat), lng: Number(l.lng) }));
  const unsuccessful = failed
    .filter(l => l.lat !== undefined && l.lng !== undefined && l.lat !== null && l.lng !== null && Number.isFinite(Number(l.lat)) && Number.isFinite(Number(l.lng)))
    .map(l => ({ type: 'failed', id: l.id, name: l.name || 'Unknown', site: l.site || '', action: l.action || '', reason: l.reason || '', time: l.time, localTime: l.localTime, lat: Number(l.lat), lng: Number(l.lng) }));
  res.json([...successful, ...unsuccessful]);
});

app.get('/api/reports/weekly', adminOnly, (req, res) => {
  const employees = readJson(EMPLOYEES_FILE, []);
  const logs = readJson(LOGS_FILE, []);
  const { monday, sunday } = weekRangeMondayToSunday(new Date());
  let report = employees.map(emp => compensationSummaryForEmployee(emp, logs, monday, sunday));
  if (req.query.site) report = report.filter(r => r.site === req.query.site);
  res.json({ weekStart: monday.toISOString(), weekEnd: sunday.toISOString(), report, siteOptions: [...new Set(employees.map(e => e.site))] });
});

app.get('/api/reports/weekly/excel', adminOnly, async (req, res) => {
  const employees = readJson(EMPLOYEES_FILE, []);
  const logs = readJson(LOGS_FILE, []);
  const { monday, sunday } = weekRangeMondayToSunday(new Date());
  const siteFilter = req.query.site || '';
  let rows = [];
  employees.forEach(emp => {
    if (siteFilter && emp.site !== siteFilter) return;
    rows.push(...dailyRowsForEmployee(emp, logs, monday, sunday));
  });

  const workbook = new ExcelJS.Workbook();
  const ws = workbook.addWorksheet('Payroll');
  ws.columns = [
    { header: 'Name', key: 'name', width: 22 },
    { header: 'Site', key: 'site', width: 22 },
    { header: 'Type', key: 'type', width: 14 },
    { header: 'Date', key: 'date', width: 14 },
    { header: 'Clock in time', key: 'clockInTime', width: 16 },
    { header: 'Clock out time', key: 'clockOutTime', width: 16 },
    { header: 'Total hours', key: 'totalHours', width: 14 },
    { header: 'Paid hours', key: 'paidHours', width: 14 },
    { header: 'Rate', key: 'rate', width: 14 },
    { header: 'Total pay', key: 'totalPay', width: 14 }
  ];
  rows.forEach(r => ws.addRow(r));
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
  doc.moveDown(0.5);
  doc.fontSize(11).text(`Site: ${siteFilter || 'All sites'}`);
  doc.text(`Week: ${dateLondon(monday)} to ${dateLondon(sunday)}`);
  doc.moveDown();

  report.forEach(row => {
    doc.fontSize(12).text(`${row.name} — ${row.site}`, { underline: true });
    doc.fontSize(10).text(`Type: ${row.compensationType} | Hours: ${row.totalHoursRaw.toFixed(2)} | Paid: ${row.paidHours.toFixed(2)} | Rate: £${Number(row.compensationRate).toFixed(2)}`);
    doc.text(`Gross: £${row.grossPay.toFixed(2)} | Advance: £${row.advanceDeduction.toFixed(2)} | Final pay: £${row.totalPay.toFixed(2)}`);
    doc.text(`Lunch: ${row.lunchMinutes} min | Days worked: ${row.daysWorked} | Must clock: ${row.mustClock ? 'Yes' : 'No'}`);
    doc.moveDown(0.8);
  });

  doc.end();
});

app.listen(PORT, '0.0.0.0', () => console.log(`ClockFlow PRO running on 0.0.0.0:${PORT}`));
