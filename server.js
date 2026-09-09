process.env.TZ = 'Europe/London';
const express = require('express');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const ExcelJS = require('exceljs');
const PDFDocument = require('pdfkit');
const crypto = require('crypto');
const webpush = require('web-push');

const app = express();
const PORT = process.env.PORT || 3000;
const ADMIN_USERNAME = process.env.ADMIN_USERNAME || 'admin';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123';
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const PUBLIC_DIR = path.join(__dirname, 'public');
const UPLOADS_DIR = path.join(DATA_DIR, 'uploads');
const EMPLOYEES_FILE = path.join(DATA_DIR, 'employees.json');
const LOGS_FILE = path.join(DATA_DIR, 'logs.json');
const SITES_FILE = path.join(DATA_DIR, 'sites.json');
const FAILED_FILE = path.join(DATA_DIR, 'failed_attempts.json');
const USERS_FILE = path.join(DATA_DIR, 'users.json');
const PUSH_SUBSCRIPTIONS_FILE = path.join(DATA_DIR, 'push_subscriptions.json');
const VAPID_FILE = path.join(DATA_DIR, 'vapid.json');
const HOLIDAYS_FILE = path.join(DATA_DIR, 'holidays.json');
const NOTIFICATIONS_FILE = path.join(DATA_DIR, 'notifications.json');
const BANK_HOLIDAYS_FILE = path.join(DATA_DIR, 'bank_holidays.json');
const DEFAULT_HOLIDAY_ENTITLEMENT = 20;
const CLOCK_GEOFENCE_METERS = 200;

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

function londonLocalToISOString(dateStr, timeStr) {
  const [year, month, day] = String(dateStr || '').split('-').map(Number);
  const [hour, minute] = String(timeStr || '').split(':').map(Number);
  if (![year, month, day, hour, minute].every(Number.isFinite)) throw new Error('Invalid London date/time');

  const utcGuess = new Date(Date.UTC(year, month - 1, day, hour, minute, 0));
  const londonParts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/London',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hourCycle: 'h23'
  }).formatToParts(utcGuess).reduce((acc, part) => {
    if (part.type !== 'literal') acc[part.type] = part.value;
    return acc;
  }, {});

  const displayedUtc = Date.UTC(
    Number(londonParts.year), Number(londonParts.month) - 1, Number(londonParts.day),
    Number(londonParts.hour), Number(londonParts.minute), Number(londonParts.second || 0)
  );
  const desiredUtc = Date.UTC(year, month - 1, day, hour, minute, 0);
  const offsetMs = displayedUtc - desiredUtc;
  return new Date(utcGuess.getTime() - offsetMs).toISOString();
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


function ymdToUtcDate(dateStr) {
  const [y, m, d] = String(dateStr || '').split('-').map(Number);
  if (![y, m, d].every(Number.isFinite)) return null;
  return new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
}
function ymd(date) {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`;
}
function addUtcDays(date, days) {
  const d = new Date(date);
  d.setUTCDate(d.getUTCDate() + days);
  return d;
}
function easterSunday(year) {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(Date.UTC(year, month - 1, day, 12));
}
function nthWeekdayOfMonth(year, monthIndex, weekday, nth) {
  const d = new Date(Date.UTC(year, monthIndex, 1, 12));
  const shift = (weekday - d.getUTCDay() + 7) % 7;
  d.setUTCDate(1 + shift + (nth - 1) * 7);
  return d;
}
function lastWeekdayOfMonth(year, monthIndex, weekday) {
  const d = new Date(Date.UTC(year, monthIndex + 1, 0, 12));
  const shift = (d.getUTCDay() - weekday + 7) % 7;
  d.setUTCDate(d.getUTCDate() - shift);
  return d;
}
function substituteIfWeekend(date) {
  const day = date.getUTCDay();
  if (day === 6) return addUtcDays(date, 2);
  if (day === 0) return addUtcDays(date, 1);
  return date;
}
function standardEnglandWalesBankHolidays(year) {
  const events = [];
  const push = (title, d) => events.push({ title, date: ymd(d) });
  push("New Year's Day", substituteIfWeekend(new Date(Date.UTC(year, 0, 1, 12))));
  const easter = easterSunday(year);
  push('Good Friday', addUtcDays(easter, -2));
  push('Easter Monday', addUtcDays(easter, 1));
  push('Early May bank holiday', nthWeekdayOfMonth(year, 4, 1, 1));
  push('Spring bank holiday', lastWeekdayOfMonth(year, 4, 1));
  push('Summer bank holiday', lastWeekdayOfMonth(year, 7, 1));
  const christmas = new Date(Date.UTC(year, 11, 25, 12));
  const boxing = new Date(Date.UTC(year, 11, 26, 12));
  if (christmas.getUTCDay() === 6) {
    push('Boxing Day', new Date(Date.UTC(year, 11, 27, 12)));
    push('Christmas Day', new Date(Date.UTC(year, 11, 28, 12)));
  } else if (christmas.getUTCDay() === 0) {
    push('Christmas Day', new Date(Date.UTC(year, 11, 27, 12)));
    push('Boxing Day', new Date(Date.UTC(year, 11, 28, 12)));
  } else if (boxing.getUTCDay() === 6) {
    push('Christmas Day', christmas);
    push('Boxing Day', new Date(Date.UTC(year, 11, 28, 12)));
  } else if (boxing.getUTCDay() === 0) {
    push('Christmas Day', christmas);
    push('Boxing Day', new Date(Date.UTC(year, 11, 27, 12)));
  } else {
    push('Christmas Day', christmas);
    push('Boxing Day', boxing);
  }
  return events.sort((a, b) => a.date.localeCompare(b.date));
}
function bankHolidayEventsForYear(year) {
  const cached = readJson(BANK_HOLIDAYS_FILE, []);
  const events = cached.filter(x => String(x.date || '').startsWith(`${year}-`));
  return events.length ? events : standardEnglandWalesBankHolidays(year);
}
function bankHolidaySetForRange(startDate, endDate) {
  const years = new Set();
  for (let y = startDate.getUTCFullYear(); y <= endDate.getUTCFullYear(); y++) years.add(y);
  const set = new Set();
  for (const y of years) bankHolidayEventsForYear(y).forEach(e => set.add(e.date));
  return set;
}
function workingDaysBetween(startStr, endStr) {
  const start = ymdToUtcDate(startStr);
  const end = ymdToUtcDate(endStr);
  if (!start || !end || start > end) return 0;
  const banks = bankHolidaySetForRange(start, end);
  let count = 0;
  for (let d = new Date(start); d <= end; d = addUtcDays(d, 1)) {
    const day = d.getUTCDay();
    const ds = ymd(d);
    if (day !== 0 && day !== 6 && !banks.has(ds)) count++;
  }
  return count;
}
function daysUntilDate(startStr) {
  const start = ymdToUtcDate(startStr);
  const today = ymdToUtcDate(dateLondon(new Date()));
  if (!start || !today) return 0;
  return Math.floor((start - today) / 86400000);
}
function holidayEntitlement(employee) {
  return toNumber(employee.holidayEntitlementDays, DEFAULT_HOLIDAY_ENTITLEMENT);
}
function holidayDaysInYear(holiday, year) {
  if (holiday.status !== 'approved') return 0;
  const start = holiday.startDate > `${year}-01-01` ? holiday.startDate : `${year}-01-01`;
  const end = holiday.endDate < `${year}-12-31` ? holiday.endDate : `${year}-12-31`;
  if (start > end) return 0;
  return workingDaysBetween(start, end);
}
function holidayBalance(employee, year = Number(dateLondon(new Date()).slice(0, 4))) {
  const holidays = readJson(HOLIDAYS_FILE, []).filter(h => h.employeeId === employee.id);
  const entitlement = holidayEntitlement(employee);
  const approved = holidays.filter(h => h.status === 'approved').reduce((sum, h) => sum + holidayDaysInYear(h, year), 0);
  const pending = holidays.filter(h => h.status === 'pending').reduce((sum, h) => {
    const start = h.startDate > `${year}-01-01` ? h.startDate : `${year}-01-01`;
    const end = h.endDate < `${year}-12-31` ? h.endDate : `${year}-12-31`;
    return sum + (start <= end ? workingDaysBetween(start, end) : 0);
  }, 0);
  return { year, entitlement, approved: Number(approved.toFixed(2)), pending: Number(pending.toFixed(2)), remaining: Number(Math.max(0, entitlement - approved).toFixed(2)) };
}
function addNotification(employeeId, type, message, meta = {}) {
  const list = readJson(NOTIFICATIONS_FILE, []);
  const item = { id: uid(), employeeId, type, message, meta, createdAt: new Date().toISOString(), readAt: null };
  list.unshift(item);
  writeJson(NOTIFICATIONS_FILE, list.slice(0, 5000));
  return item;
}
function getUnreadNotifications(employeeId) {
  return readJson(NOTIFICATIONS_FILE, []).filter(n => n.employeeId === employeeId && !n.readAt).slice(0, 20);
}
async function pushToAdminEmployees(title, message, url = '/admin.html') {
  const employees = readJson(EMPLOYEES_FILE, []);
  const adminIds = new Set(employees.filter(e => e.isAdmin).map(e => e.id));
  const subscriptions = readJson(PUSH_SUBSCRIPTIONS_FILE, []).filter(s => adminIds.has(s.employeeId));
  if (!subscriptions.length) return;
  const payload = { title, body: message, url, icon: '/icon-192.png', badge: '/icon-192.png', timestamp: Date.now() };
  await Promise.all(subscriptions.map(s => sendPushToRecord(s, payload)));
}
async function refreshBankHolidaysFromGov() {
  try {
    const response = await fetch('https://www.gov.uk/bank-holidays.json', { headers: { 'user-agent': 'ClockFlow/3.1' } });
    if (!response.ok) return;
    const data = await response.json();
    const events = (data['england-and-wales']?.events || []).map(e => ({ title: e.title, date: e.date })).filter(e => /^\d{4}-\d{2}-\d{2}$/.test(e.date));
    if (events.length) writeJson(BANK_HOLIDAYS_FILE, events);
  } catch (_) {}
}
function migrateSiteRadii() {
  const sites = readJson(SITES_FILE, []);
  let changed = false;
  sites.forEach(site => {
    if (Number(site.radiusMeters) !== CLOCK_GEOFENCE_METERS) {
      site.radiusMeters = CLOCK_GEOFENCE_METERS;
      changed = true;
    }
  });
  if (changed) writeJson(SITES_FILE, sites);
}
function runAutoClockOutSweep() {
  const logs = readJson(LOGS_FILE, []);
  const employees = readJson(EMPLOYEES_FILE, []);
  const today = dateLondon(new Date());
  const nowTime = timeLondon(new Date());
  let changed = false;
  for (const employee of employees) {
    if (employee.mustClock === false) continue;
    const mine = logs.filter(l => l.employeeId === employee.id).sort((a, b) => new Date(a.time) - new Date(b.time));
    const last = mine[mine.length - 1];
    if (!last || last.action !== 'in') continue;
    const openDate = dateLondon(last.time);
    const due = openDate < today || (openDate === today && nowTime >= '23:30:00');
    if (!due) continue;
    let autoTime;
    try { autoTime = londonLocalToISOString(openDate, '13:00'); } catch { continue; }
    logs.push(buildLogEntry({
      employee,
      action: 'out',
      timeISO: autoTime,
      geo: { required: false, allowed: true, distanceMeters: null, siteName: employee.site },
      source: 'auto-clockout',
      notes: 'Automatic Clock Out at 13:00 because employee did not clock out by 23:30.'
    }));
    addNotification(employee.id, 'missed-clockout', `You did not clock out on ${openDate}. ClockFlow automatically set your Clock Out to 13:00. Please speak to a manager if this needs correcting.`, { date: openDate, autoClockOut: '13:00' });
    changed = true;
  }
  if (changed) writeJson(LOGS_FILE, logs);
}

function signAdminEmployeeToken(employeeId) {
  const payload = Buffer.from(JSON.stringify({ employeeId, iat: Date.now() })).toString('base64url');
  const sig = crypto.createHmac('sha256', ADMIN_PASSWORD).update(payload).digest('base64url');
  return `${payload}.${sig}`;
}
function verifyAdminEmployeeToken(token) {
  if (!token || !String(token).includes('.')) return null;
  const [payload, sig] = String(token).split('.');
  const expected = crypto.createHmac('sha256', ADMIN_PASSWORD).update(payload).digest('base64url');
  try {
    if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  } catch { return null; }
  let data;
  try { data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')); } catch { return null; }
  if (!data.employeeId || !data.iat) return null;
  if (Date.now() - Number(data.iat) > 1000 * 60 * 60 * 24 * 14) return null;
  const employee = readJson(EMPLOYEES_FILE, []).find(e => e.id === data.employeeId);
  return employee && employee.isAdmin ? employee : null;
}

function adminOnly(req, res, next) {
  const password = req.headers['x-admin-password'] || req.query.adminPassword || req.query.password;
  const token = req.headers['x-admin-token'] || req.query.adminToken;
  if (String(password || '') === String(ADMIN_PASSWORD)) return next();
  if (verifyAdminEmployeeToken(token)) return next();
  return res.status(401).json({ error: 'Unauthorized' });
}
function getReportDateRange(query = {}) {
  const { start, end, date } = query;
  if (start && end) {
    const startDate = new Date(`${start}T00:00:00`);
    const endDate = new Date(`${end}T23:59:59.999`);
    if (!Number.isNaN(startDate.getTime()) && !Number.isNaN(endDate.getTime()) && startDate <= endDate) {
      return { startDate, endDate, label: `${dateLondon(startDate)} to ${dateLondon(endDate)}` };
    }
  }
  if (date) {
    const picked = new Date(`${date}T12:00:00`);
    if (!Number.isNaN(picked.getTime())) {
      const range = weekRangeMondayToSunday(picked);
      return { startDate: range.monday, endDate: range.sunday, label: `${dateLondon(range.monday)} to ${dateLondon(range.sunday)}` };
    }
  }
  const range = weekRangeMondayToSunday(new Date());
  return { startDate: range.monday, endDate: range.sunday, label: `${dateLondon(range.monday)} to ${dateLondon(range.sunday)}` };
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

function groupLogsByDay(employee, logs, start, end) {
  const startDate = new Date(`${dateLondon(start)}T12:00:00`);
  const endDate = new Date(`${dateLondon(end)}T12:00:00`);
  const days = [];
  const byDate = new Map();
  logs.filter(l => l.employeeId === employee.id).forEach(log => {
    const key = dateLondon(log.time);
    if (!byDate.has(key)) byDate.set(key, []);
    byDate.get(key).push(log);
  });

  for (let d = new Date(startDate); d <= endDate; d.setDate(d.getDate() + 1)) {
    const key = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
    const dayLogs = (byDate.get(key) || []).sort((a, b) => new Date(a.time) - new Date(b.time));
    let totalMs = 0;
    let openIn = null;
    for (const log of dayLogs) {
      if (log.action === 'in') openIn = log;
      else if (log.action === 'out' && openIn) {
        totalMs += Math.max(0, new Date(log.time) - new Date(openIn.time));
        openIn = null;
      }
    }
    days.push({
      date: key,
      logs: dayLogs,
      totalHours: Number((totalMs / 36e5).toFixed(2)),
      openSession: !!openIn
    });
  }
  return days;
}


function getVapidKeys() {
  const envPublic = process.env.VAPID_PUBLIC_KEY;
  const envPrivate = process.env.VAPID_PRIVATE_KEY;
  if (envPublic && envPrivate) return { publicKey: envPublic, privateKey: envPrivate };
  let stored = readJson(VAPID_FILE, null);
  if (!stored || !stored.publicKey || !stored.privateKey) {
    stored = webpush.generateVAPIDKeys();
    writeJson(VAPID_FILE, stored);
  }
  return stored;
}
function setupWebPush() {
  const keys = getVapidKeys();
  const subject = process.env.VAPID_SUBJECT || 'mailto:admin@clockflow.local';
  webpush.setVapidDetails(subject, keys.publicKey, keys.privateKey);
}
function normalizeSubscriptionRecord(employee, subscription) {
  return {
    id: uid(),
    employeeId: employee.id,
    employeeName: employee.name,
    endpoint: subscription.endpoint,
    subscription,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    userAgent: ''
  };
}
async function sendPushToRecord(record, payload) {
  try {
    await webpush.sendNotification(record.subscription, JSON.stringify(payload));
    return { ok: true, employeeId: record.employeeId, endpoint: record.endpoint };
  } catch (err) {
    return { ok: false, employeeId: record.employeeId, endpoint: record.endpoint, statusCode: err.statusCode, error: err.message };
  }
}

function ensureSeed() {
  ensureDir(DATA_DIR);
  ensureDir(UPLOADS_DIR);
  ensureFile(SITES_FILE, [
    { id: 'vrs-mechanical', name: 'VRS Mechanical', address: '91a, Thames Industrial Park, East Tilbury, Tilbury RM18 8RH', lat: 51.47873004008197, lng: 0.4137913929600394, radiusMeters: 200 },
    { id: 'vrs-east-tilbury', name: 'VRS Bodyshop', address: '91a, Thames Industrial Park, East Tilbury, Tilbury RM18 8RH', lat: 51.47873004008197, lng: 0.4137913929600394, radiusMeters: 200 },
    { id: 'alk-grays', name: 'ALK Bodyshop', address: 'Unit 7, Cliffside Estate, Grays RM17 5XR', lat: 51.4838239, lng: 0.3094763, radiusMeters: 200 }
  ]);
  ensureFile(EMPLOYEES_FILE, []);
  ensureFile(LOGS_FILE, []);
  ensureFile(FAILED_FILE, []);
  ensureFile(USERS_FILE, []);
  ensureFile(PUSH_SUBSCRIPTIONS_FILE, []);
  ensureFile(HOLIDAYS_FILE, []);
  ensureFile(NOTIFICATIONS_FILE, []);
  ensureFile(BANK_HOLIDAYS_FILE, []);
  setupWebPush();
  migrateSiteRadii();
  refreshBankHolidaysFromGov();
}
ensureSeed();

app.get('/', (req, res) => res.redirect('/mobile.html'));
app.get('/admin', (req, res) => res.redirect('/admin.html'));
app.get('/health', (req, res) => res.status(200).send('OK'));

app.post('/api/admin-login', (req, res) => {
  const { username, password } = req.body || {};
  const suppliedUsername = String(username || ADMIN_USERNAME).trim();
  const validUsername = suppliedUsername.toLowerCase() === String(ADMIN_USERNAME).trim().toLowerCase();
  const validPassword = String(password || '') === String(ADMIN_PASSWORD);
  if (!validUsername || !validPassword) return res.status(401).json({ error: 'Invalid admin login or password' });
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
    documents: [],
    holidayEntitlementDays: toNumber(body.holidayEntitlementDays, DEFAULT_HOLIDAY_ENTITLEMENT)
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
    documents: Array.isArray(current.documents) ? current.documents : [],
    holidayEntitlementDays: toNumber(body.holidayEntitlementDays ?? current.holidayEntitlementDays, DEFAULT_HOLIDAY_ENTITLEMENT)
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
  runAutoClockOutSweep();
  const { login, pin } = req.body || {};
  const employee = authenticateEmployee(login, pin);
  if (!employee) return res.status(401).json({ error: 'Invalid login or PIN' });
  const logs = readJson(LOGS_FILE, []);
  const state = getEmployeeCurrentState(employee.id, logs);
  const response = { success: true, employee: employeeSafe(employee), state, holidayBalance: holidayBalance(employee), notifications: getUnreadNotifications(employee.id) };
  if (employee.isAdmin) {
    response.adminToken = signAdminEmployeeToken(employee.id);
    response.pendingHolidayRequests = readJson(HOLIDAYS_FILE, []).filter(h => h.status === 'pending');
  }
  res.json(response);
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


app.get('/api/holidays/bank-holidays', (req, res) => {
  const year = Number(req.query.year || dateLondon(new Date()).slice(0, 4));
  res.json({ year, region: 'england-and-wales', events: bankHolidayEventsForYear(year) });
});

app.get('/api/holidays/mine', (req, res) => {
  const { employeeId, pin } = req.query;
  const employee = authenticateEmployeeById(employeeId, pin);
  if (!employee) return res.status(401).json({ error: 'Unauthorized' });
  const year = Number(req.query.year || dateLondon(new Date()).slice(0, 4));
  const holidays = readJson(HOLIDAYS_FILE, []).filter(h => h.employeeId === employee.id).sort((a, b) => b.startDate.localeCompare(a.startDate));
  res.json({ balance: holidayBalance(employee, year), holidays, bankHolidays: bankHolidayEventsForYear(year) });
});

app.post('/api/holidays/request', async (req, res) => {
  const { employeeId, pin, startDate, endDate, note = '' } = req.body || {};
  const employee = authenticateEmployeeById(employeeId, pin);
  if (!employee) return res.status(401).json({ error: 'Unauthorized' });
  const start = ymdToUtcDate(startDate);
  const end = ymdToUtcDate(endDate);
  const today = dateLondon(new Date());
  if (!start || !end || start > end) return res.status(400).json({ error: 'Invalid holiday dates' });
  if (startDate < today) return res.status(400).json({ error: 'Employees cannot request holiday in the past. Please speak to a manager.' });
  const workingDays = workingDaysBetween(startDate, endDate);
  if (workingDays <= 0) return res.status(400).json({ error: 'The selected period contains no working days.' });
  const holidays = readJson(HOLIDAYS_FILE, []);
  const overlap = holidays.some(h => h.employeeId === employee.id && h.status !== 'rejected' && startDate <= h.endDate && endDate >= h.startDate);
  if (overlap) return res.status(400).json({ error: 'This request overlaps an existing holiday request.' });
  const year = Number(startDate.slice(0, 4));
  const balance = holidayBalance(employee, year);
  if (workingDays > balance.remaining) return res.status(400).json({ error: `Not enough holiday remaining. Available: ${balance.remaining} day(s).` });
  const noticeDays = daysUntilDate(startDate);
  const item = {
    id: uid(), employeeId: employee.id, name: employee.name, site: employee.site,
    startDate, endDate, workingDays, status: 'pending', lateRequest: noticeDays < 10,
    noticeDays, requestedAt: new Date().toISOString(), requestedBy: 'employee', note: sanitizeText(note),
    decisionAt: null, decisionBy: null, decisionNote: ''
  };
  holidays.unshift(item);
  writeJson(HOLIDAYS_FILE, holidays);
  pushToAdminEmployees('Holiday Request', `${employee.name} requested ${workingDays} working day(s): ${startDate} to ${endDate}${item.lateRequest ? ' — LESS THAN 10 DAYS NOTICE' : ''}`, '/admin.html').catch(() => {});
  res.json({ success: true, holiday: item, balance: holidayBalance(employee, year) });
});

app.post('/api/notifications/:id/read', (req, res) => {
  const { employeeId, pin } = req.body || {};
  const employee = authenticateEmployeeById(employeeId, pin);
  if (!employee) return res.status(401).json({ error: 'Unauthorized' });
  const list = readJson(NOTIFICATIONS_FILE, []);
  const idx = list.findIndex(n => n.id === req.params.id && n.employeeId === employee.id);
  if (idx === -1) return res.status(404).json({ error: 'Notification not found' });
  list[idx].readAt = new Date().toISOString();
  writeJson(NOTIFICATIONS_FILE, list);
  res.json({ success: true });
});

app.get('/api/admin/holidays', adminOnly, (req, res) => {
  const employees = readJson(EMPLOYEES_FILE, []);
  const holidays = readJson(HOLIDAYS_FILE, []).sort((a, b) => b.requestedAt.localeCompare(a.requestedAt));
  const year = Number(req.query.year || dateLondon(new Date()).slice(0, 4));
  res.json({
    year,
    holidays,
    bankHolidays: bankHolidayEventsForYear(year),
    employees: employees.map(e => ({ ...employeeSafe(e), holidayBalance: holidayBalance(e, year) }))
  });
});

app.post('/api/admin/holidays/manual', adminOnly, (req, res) => {
  const { employeeId, startDate, endDate, note = '' } = req.body || {};
  const employees = readJson(EMPLOYEES_FILE, []);
  const employee = employees.find(e => e.id === employeeId);
  if (!employee) return res.status(404).json({ error: 'Employee not found' });
  const start = ymdToUtcDate(startDate), end = ymdToUtcDate(endDate);
  if (!start || !end || start > end) return res.status(400).json({ error: 'Invalid holiday dates' });
  const workingDays = workingDaysBetween(startDate, endDate);
  if (workingDays <= 0) return res.status(400).json({ error: 'The selected period contains no working days.' });
  const holidays = readJson(HOLIDAYS_FILE, []);
  const item = {
    id: uid(), employeeId: employee.id, name: employee.name, site: employee.site,
    startDate, endDate, workingDays, status: 'approved', lateRequest: false, noticeDays: null,
    requestedAt: new Date().toISOString(), requestedBy: 'manager', manual: true,
    note: sanitizeText(note), decisionAt: new Date().toISOString(), decisionBy: 'manager', decisionNote: 'Added manually by manager'
  };
  holidays.unshift(item);
  writeJson(HOLIDAYS_FILE, holidays);
  addNotification(employee.id, 'holiday-approved', `A manager added ${workingDays} working day(s) of holiday: ${startDate} to ${endDate}.`, { holidayId: item.id });
  res.json({ success: true, holiday: item, balance: holidayBalance(employee, Number(startDate.slice(0, 4))) });
});

app.post('/api/admin/holidays/:id/decision', adminOnly, (req, res) => {
  const { decision, note = '' } = req.body || {};
  if (!['approved', 'rejected'].includes(decision)) return res.status(400).json({ error: 'Decision must be approved or rejected' });
  const holidays = readJson(HOLIDAYS_FILE, []);
  const idx = holidays.findIndex(h => h.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Holiday request not found' });
  const item = holidays[idx];
  const employee = readJson(EMPLOYEES_FILE, []).find(e => e.id === item.employeeId);
  if (!employee) return res.status(404).json({ error: 'Employee not found' });
  if (decision === 'approved') {
    const bal = holidayBalance(employee, Number(item.startDate.slice(0, 4)));
    if (item.workingDays > bal.remaining) return res.status(400).json({ error: `Cannot approve: employee has only ${bal.remaining} holiday day(s) remaining.` });
  }
  item.status = decision;
  item.decisionAt = new Date().toISOString();
  item.decisionBy = 'manager';
  item.decisionNote = sanitizeText(note);
  holidays[idx] = item;
  writeJson(HOLIDAYS_FILE, holidays);
  addNotification(employee.id, decision === 'approved' ? 'holiday-approved' : 'holiday-rejected', `Your holiday request ${item.startDate} to ${item.endDate} has been ${decision}.${note ? ` Manager note: ${sanitizeText(note)}` : ''}`, { holidayId: item.id });
  res.json({ success: true, holiday: item, balance: holidayBalance(employee, Number(item.startDate.slice(0, 4))) });
});

app.delete('/api/admin/holidays/:id', adminOnly, (req, res) => {
  const holidays = readJson(HOLIDAYS_FILE, []);
  const next = holidays.filter(h => h.id !== req.params.id);
  if (next.length === holidays.length) return res.status(404).json({ error: 'Holiday record not found' });
  writeJson(HOLIDAYS_FILE, next);
  res.json({ success: true });
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
  const entry = buildLogEntry({ employee, action, timeISO: londonLocalToISOString(date, time), lat: null, lng: null, geo: { required: false, allowed: true, distanceMeters: null, siteName: employee.site }, source: 'manual', notes: notes || '' });
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
  const timeISO = body.date && body.time ? londonLocalToISOString(body.date, body.time) : current.time;
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


app.get('/api/employee-timesheet', adminOnly, (req, res) => {
  const { employeeId, start, end } = req.query;
  if (!employeeId) return res.status(400).json({ error: 'Missing employeeId' });

  const employees = readJson(EMPLOYEES_FILE, []);
  const logs = readJson(LOGS_FILE, []);
  const employee = employees.find(e => e.id === employeeId);
  if (!employee) return res.status(404).json({ error: 'Employee not found' });

  let startDate;
  let endDate;
  if (start && end) {
    startDate = new Date(`${start}T00:00:00`);
    endDate = new Date(`${end}T23:59:59`);
  } else {
    const range = weekRangeMondayToSunday(new Date());
    startDate = range.monday;
    endDate = range.sunday;
  }
  const days = groupLogsByDay(employee, logs, startDate, endDate);
  res.json({
    employee: employeeSafe(employee),
    start: dateLondon(startDate),
    end: dateLondon(endDate),
    days
  });
});


app.get('/api/push/public-key', (req, res) => {
  const keys = getVapidKeys();
  res.json({ publicKey: keys.publicKey });
});

app.post('/api/push/subscribe', (req, res) => {
  const { employeeId, pin, subscription } = req.body || {};
  const employee = authenticateEmployeeById(employeeId, pin);
  if (!employee) return res.status(401).json({ error: 'Invalid employee or PIN' });
  if (!subscription || !subscription.endpoint) return res.status(400).json({ error: 'Missing push subscription' });
  const subscriptions = readJson(PUSH_SUBSCRIPTIONS_FILE, []);
  const existingIndex = subscriptions.findIndex(s => s.endpoint === subscription.endpoint);
  const record = normalizeSubscriptionRecord(employee, subscription);
  record.userAgent = String(req.headers['user-agent'] || '');
  if (existingIndex >= 0) {
    subscriptions[existingIndex] = { ...subscriptions[existingIndex], ...record, id: subscriptions[existingIndex].id || record.id, createdAt: subscriptions[existingIndex].createdAt || record.createdAt };
  } else {
    subscriptions.push(record);
  }
  writeJson(PUSH_SUBSCRIPTIONS_FILE, subscriptions);
  res.json({ success: true, employee: employeeSafe(employee) });
});

app.post('/api/push/unsubscribe', (req, res) => {
  const { employeeId, pin, endpoint } = req.body || {};
  const employee = authenticateEmployeeById(employeeId, pin);
  if (!employee) return res.status(401).json({ error: 'Invalid employee or PIN' });
  const subscriptions = readJson(PUSH_SUBSCRIPTIONS_FILE, []).filter(s => !(s.employeeId === employee.id && (!endpoint || s.endpoint === endpoint)));
  writeJson(PUSH_SUBSCRIPTIONS_FILE, subscriptions);
  res.json({ success: true });
});

app.get('/api/push/subscriptions', adminOnly, (req, res) => {
  const employees = readJson(EMPLOYEES_FILE, []);
  const subscriptions = readJson(PUSH_SUBSCRIPTIONS_FILE, []);
  const byEmployee = employees.map(emp => ({
    employee: employeeSafe(emp),
    devices: subscriptions.filter(s => s.employeeId === emp.id).map(s => ({ id: s.id, createdAt: s.createdAt, updatedAt: s.updatedAt, endpoint: s.endpoint }))
  }));
  res.json({ employees: byEmployee, totalDevices: subscriptions.length });
});

app.post('/api/push/send', adminOnly, async (req, res) => {
  const { employeeId = 'all', title = 'ClockFlow', message = '', url = '/mobile.html' } = req.body || {};
  if (!String(message || '').trim()) return res.status(400).json({ error: 'Message is required' });
  const subscriptions = readJson(PUSH_SUBSCRIPTIONS_FILE, []);
  let targets = subscriptions;
  if (employeeId && employeeId !== 'all') targets = subscriptions.filter(s => s.employeeId === employeeId);
  if (!targets.length) return res.status(404).json({ error: 'No subscribed devices found' });
  const payload = {
    title: String(title || 'ClockFlow'),
    body: String(message),
    url: String(url || '/mobile.html'),
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    timestamp: Date.now()
  };
  const results = await Promise.all(targets.map(t => sendPushToRecord(t, payload)));
  const expiredEndpoints = results.filter(r => !r.ok && [404, 410].includes(Number(r.statusCode))).map(r => r.endpoint);
  if (expiredEndpoints.length) {
    const remaining = subscriptions.filter(s => !expiredEndpoints.includes(s.endpoint));
    writeJson(PUSH_SUBSCRIPTIONS_FILE, remaining);
  }
  res.json({ success: true, sent: results.filter(r => r.ok).length, failed: results.filter(r => !r.ok).length, results });
});

app.post('/api/push/reminder-test', adminOnly, async (req, res) => {
  const { type = 'clock-in' } = req.body || {};
  const message = type === 'clock-out' ? 'Reminder: please clock out before leaving site.' : 'Reminder: please clock in when you arrive on site.';
  const subscriptions = readJson(PUSH_SUBSCRIPTIONS_FILE, []);
  const payload = { title: 'ClockFlow Reminder', body: message, url: '/mobile.html', timestamp: Date.now() };
  const results = await Promise.all(subscriptions.map(t => sendPushToRecord(t, payload)));
  res.json({ success: true, sent: results.filter(r => r.ok).length, failed: results.filter(r => !r.ok).length });
});

app.get('/api/reports/weekly', adminOnly, (req, res) => {
  const employees = readJson(EMPLOYEES_FILE, []);
  const logs = readJson(LOGS_FILE, []);
  const { startDate, endDate } = getReportDateRange(req.query);
  let report = employees.map(emp => compensationSummaryForEmployee(emp, logs, startDate, endDate));
  if (req.query.site) report = report.filter(r => r.site === req.query.site);
  res.json({ weekStart: startDate.toISOString(), weekEnd: endDate.toISOString(), report });
});
app.get('/api/reports/weekly/excel', adminOnly, async (req, res) => {
  const employees = readJson(EMPLOYEES_FILE, []);
  const logs = readJson(LOGS_FILE, []);
  const { startDate, endDate } = getReportDateRange(req.query);
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
    dailyRowsForEmployee(emp, logs, startDate, endDate).forEach(r => ws.addRow(r));
  });
  ws.getRow(1).font = { bold: true };
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="payroll-${siteFilter || 'all-sites'}-${dateLondon(startDate)}-to-${dateLondon(endDate)}.xlsx"`);
  await workbook.xlsx.write(res);
  res.end();
});
app.get('/api/reports/weekly/pdf', adminOnly, (req, res) => {
  const employees = readJson(EMPLOYEES_FILE, []);
  const logs = readJson(LOGS_FILE, []);
  const { startDate, endDate } = getReportDateRange(req.query);
  const siteFilter = req.query.site || '';
  const report = employees.filter(emp => !siteFilter || emp.site === siteFilter).map(emp => compensationSummaryForEmployee(emp, logs, startDate, endDate));
  const doc = new PDFDocument({ margin: 40, size: 'A4' });
  const filename = `payroll-${siteFilter || 'all-sites'}-${dateLondon(startDate)}-to-${dateLondon(endDate)}.pdf`;
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  doc.pipe(res);
  doc.fontSize(18).text('ClockFlow Weekly Payroll', { align: 'center' });
  doc.moveDown(0.5).fontSize(11).text(`Site: ${siteFilter || 'All sites'}`).text(`Date range: ${dateLondon(startDate)} to ${dateLondon(endDate)}`);
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

setTimeout(runAutoClockOutSweep, 2000);
setInterval(runAutoClockOutSweep, 60 * 1000);
setInterval(refreshBankHolidaysFromGov, 24 * 60 * 60 * 1000);

app.listen(PORT, '0.0.0.0', () => console.log(`ClockFlow running on 0.0.0.0:${PORT}`));
