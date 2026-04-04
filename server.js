
const express = require('express');
const fs = require('fs');
const path = require('path');
const ExcelJS = require('exceljs');
const PDFDocument = require('pdfkit');

const app = express();
const PORT = process.env.PORT || 3000;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123';

app.use(express.json({ limit: '2mb' }));
app.use(express.static(path.join(__dirname, 'public')));

const DATA_DIR = path.join(__dirname, 'data');
const EMPLOYEES_FILE = path.join(DATA_DIR, 'employees.json');
const LOGS_FILE = path.join(DATA_DIR, 'logs.json');
const SITES_FILE = path.join(DATA_DIR, 'sites.json');
const FAILED_FILE = path.join(DATA_DIR, 'failed_attempts.json');

function ensureDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}
function ensureFile(file, fallback) {
  ensureDir();
  if (!fs.existsSync(file)) fs.writeFileSync(file, JSON.stringify(fallback, null, 2), 'utf8');
}
function readJson(file, fallback=[]) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}
function writeJson(file, data) {
  ensureDir();
  fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf8');
}
function uid() {
  return Date.now().toString() + Math.random().toString(16).slice(2,8);
}
function toNumber(v, fallback=0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}
function sanitizeText(v='') { return String(v).trim(); }

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
function dateLondon(date) {
  return new Intl.DateTimeFormat('en-CA', { timeZone:'Europe/London', year:'numeric', month:'2-digit', day:'2-digit'}).format(new Date(date));
}
function timeLondon(date) {
  return new Intl.DateTimeFormat('en-GB', { timeZone:'Europe/London', hour:'2-digit', minute:'2-digit', second:'2-digit', hour12:false }).format(new Date(date));
}
function startEndOfDayLondon(dateStr) {
  const d = dateStr ? new Date(`${dateStr}T12:00:00`) : new Date();
  const dayInUK = new Date(new Intl.DateTimeFormat('en-CA', { timeZone:'Europe/London', year:'numeric', month:'2-digit', day:'2-digit'}).format(d) + 'T00:00:00');
  const next = new Date(dayInUK);
  next.setDate(dayInUK.getDate()+1);
  return { start: dayInUK, end: next };
}
function weekRangeMondayToSunday(inputDate=new Date()) {
  const d = new Date(inputDate);
  const day = d.getUTCDay();
  const diff = day === 0 ? -6 : 1 - day;
  const monday = new Date(d);
  monday.setUTCDate(d.getUTCDate() + diff);
  monday.setUTCHours(0,0,0,0);
  const sunday = new Date(monday);
  sunday.setUTCDate(monday.getUTCDate() + 6);
  sunday.setUTCHours(23,59,59,999);
  return { monday, sunday };
}
function haversineMeters(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const toRad = d => d * Math.PI / 180;
  const dLat = toRad(lat2-lat1);
  const dLon = toRad(lon2-lon1);
  const a = Math.sin(dLat/2)**2 + Math.cos(toRad(lat1))*Math.cos(toRad(lat2))*Math.sin(dLon/2)**2;
  return 2*R*Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}
function adminOnly(req,res,next){
  const password = req.headers['x-admin-password'] || req.query.adminPassword || req.query.password;
  if (String(password||'') !== String(ADMIN_PASSWORD)) return res.status(401).json({ error:'Unauthorized' });
  next();
}
function buildLogEntry({employee, action, timeISO, lat=null, lng=null, geo, source='mobile', notes=''}) {
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
function compensationSummaryForEmployee(employee, logs, weekStart, weekEnd){
  const mine = logs
    .filter(l => l.employeeId === employee.id)
    .filter(l => {
      const t = new Date(l.time);
      return t >= weekStart && t <= weekEnd;
    })
    .sort((a,b) => new Date(a.time)-new Date(b.time));
  let totalMs=0;
  let openIn=null;
  const rows=[];
  for (const log of mine){
    if (log.action === 'in') {
      openIn = log;
    } else if (log.action === 'out' && openIn) {
      const start = new Date(openIn.time);
      const end = new Date(log.time);
      const ms = Math.max(0, end-start);
      totalMs += ms;
      rows.push({ in: openIn, out: log, ms });
      openIn = null;
    }
  }
  const totalHoursRaw = totalMs/36e5;
  const lunchHours = (toNumber(employee.lunchMinutes,0)/60) * rows.length;
  const paidHours = Math.max(0, totalHoursRaw - lunchHours);
  const compensationType = employee.compensationType || 'hourly';
  const compensationRate = toNumber(employee.compensationRate ?? employee.hourlyRate ?? 0, 0);
  let totalPay = 0;
  if (compensationType === 'hourly') {
    totalPay = paidHours * compensationRate;
  } else if (compensationType === 'daily') {
    totalPay = rows.length * compensationRate;
  } else if (compensationType === 'weekly') {
    totalPay = rows.length > 0 ? compensationRate : 0;
  }
  return {
    employeeId: employee.id,
    name: employee.name,
    site: employee.site,
    compensationType,
    hourlyRate: compensationType === 'hourly' ? compensationRate : 0,
    compensationRate,
    lunchMinutes: toNumber(employee.lunchMinutes,0),
    daysWorked: rows.length,
    totalHoursRaw: Number(totalHoursRaw.toFixed(2)),
    paidHours: Number(paidHours.toFixed(2)),
    totalPay: Number(totalPay.toFixed(2)),
    pairs: rows
  };
}
function dailyRowsForEmployee(employee, logs, weekStart, weekEnd){
  const mine = logs
    .filter(l => l.employeeId === employee.id)
    .filter(l => {
      const t = new Date(l.time);
      return t >= weekStart && t <= weekEnd;
    })
    .sort((a,b) => new Date(a.time)-new Date(b.time));

  let openIn = null;
  const rows = [];
  for (const log of mine) {
    if (log.action === 'in') openIn = log;
    else if (log.action === 'out' && openIn) {
      const inTime = new Date(openIn.time);
      const outTime = new Date(log.time);
      const hours = Math.max(0, (outTime - inTime)/36e5);
      const rate = toNumber(employee.compensationRate ?? employee.hourlyRate ?? 0, 0);
      const compensationType = employee.compensationType || 'hourly';
      let totalPay = compensationType === 'hourly' ? Math.max(0, hours - toNumber(employee.lunchMinutes,0)/60) * rate : compensationType === 'daily' ? rate : rate;
      rows.push({
        name: employee.name,
        site: employee.site,
        date: dateLondon(openIn.time),
        clockInTime: timeLondon(openIn.time),
        clockOutTime: timeLondon(log.time),
        totalHours: Number(hours.toFixed(2)),
        hourlyRate: rate,
        totalPay: Number(totalPay.toFixed(2))
      });
      openIn = null;
    }
  }
  return rows;
}
function ensureSeed(){
  ensureFile(SITES_FILE, [
    { id:'vrs-east-tilbury', name:'VRS East Tilbury', address:'91a, Thames Industrial Park, East Tilbury, Tilbury RM18 8RH', lat:51.4848, lng:0.4122, radiusMeters:200 },
    { id:'alk-grays', name:'ALK Bodyshop', address:'Unit 7, Cliffside Estate, Grays RM17 5XR', lat:51.4704, lng:0.3313, radiusMeters:200 }
  ]);
  ensureFile(EMPLOYEES_FILE, [
    { id:'damian', name:'Damian', pin:'1234', site:'VRS Mechanical', siteId:'vrs-east-tilbury', hourlyRate:0, compensationType:'hourly', compensationRate:0, lunchMinutes:0, geoRequired:false, isAdmin:true }
  ]);
  ensureFile(LOGS_FILE, []);
  ensureFile(FAILED_FILE, []);
}
ensureSeed();

app.get('/', (req,res)=>res.redirect('/mobile.html'));
app.get('/admin', (req,res)=>res.redirect('/admin.html'));
app.get('/health', (req,res)=>res.status(200).send('OK'));
app.post('/api/admin-login', (req,res)=>{
  const { password } = req.body || {};
  if (String(password||'') !== String(ADMIN_PASSWORD)) return res.status(401).json({ error:'Invalid admin password' });
  res.json({ success:true });
});

app.get('/api/sites', adminOnly, (req,res)=> res.json(readJson(SITES_FILE, [])));
app.get('/api/employees', (req,res)=>{
  const employees = readJson(EMPLOYEES_FILE, []);
  res.json(employees.map(({pin, ...rest})=>rest));
});
app.post('/api/employees', adminOnly, (req,res)=>{
  const employees = readJson(EMPLOYEES_FILE, []);
  const body = req.body || {};
  if (!body.name || !body.pin || !body.site || !body.siteId) return res.status(400).json({ error:'Missing required fields' });
  const employee = {
    id: uid(),
    name: sanitizeText(body.name),
    pin: sanitizeText(body.pin),
    site: sanitizeText(body.site),
    siteId: sanitizeText(body.siteId),
    hourlyRate: toNumber(body.hourlyRate, 0),
    compensationType: sanitizeText(body.compensationType || 'hourly'),
    compensationRate: toNumber(body.compensationRate ?? body.hourlyRate, 0),
    lunchMinutes: toNumber(body.lunchMinutes, 0),
    geoRequired: Boolean(body.geoRequired),
    isAdmin: Boolean(body.isAdmin)
  };
  employees.push(employee);
  writeJson(EMPLOYEES_FILE, employees);
  res.json({ success:true, employee: {...employee, pin: undefined } });
});
app.put('/api/employees/:id', adminOnly, (req,res)=>{
  const employees = readJson(EMPLOYEES_FILE, []);
  const idx = employees.findIndex(e=>e.id===req.params.id);
  if (idx === -1) return res.status(404).json({ error:'Employee not found' });
  const current = employees[idx];
  const body = req.body || {};
  const next = {
    ...current,
    ...body,
    name: body.name !== undefined ? sanitizeText(body.name) : current.name,
    pin: body.pin !== undefined && String(body.pin).trim() !== '' ? sanitizeText(body.pin) : current.pin,
    site: body.site !== undefined ? sanitizeText(body.site) : current.site,
    siteId: body.siteId !== undefined ? sanitizeText(body.siteId) : current.siteId,
    hourlyRate: toNumber(body.hourlyRate ?? current.hourlyRate, current.hourlyRate),
    compensationType: sanitizeText(body.compensationType ?? current.compensationType ?? 'hourly'),
    compensationRate: toNumber(body.compensationRate ?? body.hourlyRate ?? current.compensationRate ?? current.hourlyRate, current.compensationRate ?? current.hourlyRate),
    lunchMinutes: toNumber(body.lunchMinutes ?? current.lunchMinutes, current.lunchMinutes),
    geoRequired: body.geoRequired === undefined ? current.geoRequired : Boolean(body.geoRequired),
    isAdmin: body.isAdmin === undefined ? current.isAdmin : Boolean(body.isAdmin)
  };
  employees[idx]=next;
  writeJson(EMPLOYEES_FILE, employees);
  const { pin, ...safe } = next;
  res.json({ success:true, employee:safe });
});
app.delete('/api/employees/:id', adminOnly, (req,res)=>{
  let employees = readJson(EMPLOYEES_FILE, []);
  const before = employees.length;
  employees = employees.filter(e=>e.id!==req.params.id);
  if (employees.length === before) return res.status(404).json({ error:'Employee not found' });
  writeJson(EMPLOYEES_FILE, employees);
  res.json({ success:true });
});

function recordFailedAttempt(payload){
  const failed = readJson(FAILED_FILE, []);
  failed.push({ id: uid(), time: new Date().toISOString(), localTime: formatLondon(new Date()), ...payload });
  writeJson(FAILED_FILE, failed);
}

app.post('/api/clock', (req,res)=>{
  const { employeeId, pin, action, lat, lng } = req.body || {};
  if (!employeeId || !pin || !action) return res.status(400).json({ error:'Missing employeeId, pin or action' });
  if (!['in','out'].includes(action)) return res.status(400).json({ error:'Action must be in or out' });

  const employees = readJson(EMPLOYEES_FILE, []);
  const sites = readJson(SITES_FILE, []);
  const logs = readJson(LOGS_FILE, []);
  const employee = employees.find(e=>e.id===employeeId);
  if (!employee) {
    recordFailedAttempt({ employeeId, action, reason:'Employee not found', lat: lat ?? null, lng: lng ?? null });
    return res.status(404).json({ error:'Employee not found' });
  }
  if (String(employee.pin) !== String(pin)) {
    recordFailedAttempt({ employeeId, name:employee.name, action, reason:'Invalid PIN', lat: lat ?? null, lng: lng ?? null });
    return res.status(401).json({ error:'Invalid PIN' });
  }
  const site = sites.find(s=>s.id===employee.siteId);
  let geo = { required:Boolean(employee.geoRequired), allowed:true, distanceMeters:null, siteName:site?.name || employee.site };

  if (employee.geoRequired) {
    if (lat === undefined || lng === undefined || !site) {
      recordFailedAttempt({ employeeId, name:employee.name, action, reason:'Missing location', site: employee.site });
      return res.status(400).json({ error:'Location is required for this employee' });
    }
    const distance = haversineMeters(Number(lat), Number(lng), Number(site.lat), Number(site.lng));
    geo.distanceMeters = Math.round(distance);
    geo.allowed = distance <= Number(site.radiusMeters || 200);
    if (!geo.allowed) {
      recordFailedAttempt({ employeeId, name:employee.name, action, reason:'Outside allowed area', distanceMeters: geo.distanceMeters, site: employee.site, lat:Number(lat), lng:Number(lng) });
      return res.status(403).json({ error:`Outside allowed area. Distance: ${geo.distanceMeters}m. Limit: ${site.radiusMeters}m` });
    }
  }

  const now = new Date();
  const entry = buildLogEntry({ employee, action, timeISO: now.toISOString(), lat: lat ?? null, lng: lng ?? null, geo, source:'mobile' });
  logs.push(entry);
  writeJson(LOGS_FILE, logs);
  res.json({ success:true, message:`${employee.name} clocked ${action}`, entry });
});

app.get('/api/logs', adminOnly, (req,res)=>{
  const logs = readJson(LOGS_FILE, []);
  res.json([...logs].sort((a,b)=> new Date(b.time)-new Date(a.time)));
});
app.get('/api/failed-attempts', adminOnly, (req,res)=>{
  const failed = readJson(FAILED_FILE, []);
  res.json([...failed].sort((a,b)=> new Date(b.time)-new Date(a.time)));
});

app.post('/api/manual-log', adminOnly, (req,res)=>{
  const { employeeId, action, date, time, notes } = req.body || {};
  if (!employeeId || !action || !date || !time) return res.status(400).json({ error:'Missing employeeId, action, date or time' });
  const employees = readJson(EMPLOYEES_FILE, []);
  const logs = readJson(LOGS_FILE, []);
  const employee = employees.find(e=>e.id===employeeId);
  if (!employee) return res.status(404).json({ error:'Employee not found' });
  const iso = new Date(`${date}T${time}:00`).toISOString();
  const entry = buildLogEntry({
    employee, action, timeISO: iso, lat:null, lng:null,
    geo:{ required:false, allowed:true, distanceMeters:null, siteName:employee.site },
    source:'manual', notes: notes || ''
  });
  logs.push(entry);
  writeJson(LOGS_FILE, logs);
  res.json({ success:true, entry });
});

app.put('/api/logs/:id', adminOnly, (req,res)=>{
  const logs = readJson(LOGS_FILE, []);
  const idx = logs.findIndex(l=>l.id===req.params.id);
  if (idx === -1) return res.status(404).json({ error:'Log not found' });
  const current = logs[idx];
  const body = req.body || {};
  let timeISO = current.time;
  if (body.date && body.time) timeISO = new Date(`${body.date}T${body.time}:00`).toISOString();
  const next = {
    ...current,
    action: body.action || current.action,
    notes: body.notes !== undefined ? body.notes : current.notes,
    time: timeISO,
    localTime: formatLondon(timeISO)
  };
  logs[idx]=next;
  writeJson(LOGS_FILE, logs);
  res.json({ success:true, entry:next });
});

app.delete('/api/logs/:id', adminOnly, (req,res)=>{
  let logs = readJson(LOGS_FILE, []);
  const before = logs.length;
  logs = logs.filter(l=>l.id !== req.params.id);
  if (logs.length === before) return res.status(404).json({ error:'Log not found' });
  writeJson(LOGS_FILE, logs);
  res.json({ success:true });
});

app.get('/api/dashboard/today', adminOnly, (req,res)=>{
  const employees = readJson(EMPLOYEES_FILE, []);
  const logs = readJson(LOGS_FILE, []);
  const { start, end } = startEndOfDayLondon(req.query.date);
  const todayLogs = logs.filter(l=> {
    const t = new Date(l.time);
    return t >= start && t < end;
  }).sort((a,b)=> new Date(a.time)-new Date(b.time));

  const employeeSummaries = employees.map(emp=>{
    const mine = todayLogs.filter(l=>l.employeeId===emp.id);
    let openIn=null,totalMs=0,lastAction='',firstIn='',lastOut='';
    for (const log of mine) {
      if (log.action==='in') { openIn=log; lastAction='IN'; if(!firstIn) firstIn=log.time; }
      else if (log.action==='out') { if(openIn){ totalMs += new Date(log.time)-new Date(openIn.time); openIn=null; } lastAction='OUT'; lastOut=log.time; }
    }
    return {
      employeeId: emp.id,
      name: emp.name,
      site: emp.site,
      todayHours: Number((totalMs/36e5).toFixed(2)),
      currentlyClockedIn: Boolean(openIn),
      firstIn: firstIn ? formatLondon(firstIn) : '',
      lastOut: lastOut ? formatLondon(lastOut) : ''
    };
  });

  const bySite = {};
  employeeSummaries.forEach(row=>{
    bySite[row.site] = bySite[row.site] || { site: row.site, employees:0, totalHours:0, clockedIn:0 };
    bySite[row.site].employees += 1;
    bySite[row.site].totalHours += row.todayHours;
    if (row.currentlyClockedIn) bySite[row.site].clockedIn += 1;
  });

  res.json({
    date: dateLondon(new Date()),
    employees: employeeSummaries,
    sites: Object.values(bySite).map(s=>({ ...s, totalHours:Number(s.totalHours.toFixed(2)) }))
  });
});

app.get('/api/map/logs', adminOnly, (req,res)=>{
  const logs = readJson(LOGS_FILE, []);
  const failed = readJson(FAILED_FILE, []);
  const successful = logs.filter(l => l.lat !== null && l.lng !== null).map(l => ({
    type:'success', id:l.id, name:l.name, site:l.site, action:l.action, time:l.time, localTime:l.localTime, lat:l.lat, lng:l.lng
  }));
  const unsuccessful = failed.filter(l => l.lat !== undefined && l.lng !== undefined && l.lat !== null && l.lng !== null).map(l => ({
    type:'failed', id:l.id, name:l.name || 'Unknown', site:l.site || '', action:l.action || '', reason:l.reason || '', time:l.time, localTime:l.localTime, lat:l.lat, lng:l.lng
  }));
  res.json([...successful, ...unsuccessful]);
});

app.get('/api/reports/weekly', adminOnly, (req,res)=>{
  const employees = readJson(EMPLOYEES_FILE, []);
  const logs = readJson(LOGS_FILE, []);
  const sites = readJson(SITES_FILE, []);
  const { monday, sunday } = weekRangeMondayToSunday(new Date());
  let report = employees.map(emp => compensationSummaryForEmployee(emp, logs, monday, sunday));
  if (req.query.site) report = report.filter(r => r.site === req.query.site);
  res.json({ weekStart: monday.toISOString(), weekEnd: sunday.toISOString(), report, siteOptions: employees.map(e=>e.site).filter((v,i,a)=>a.indexOf(v)===i) });
});

app.get('/api/reports/weekly/excel', adminOnly, async (req,res)=>{
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
    { header:'Name', key:'name', width:22 },
    { header:'Site', key:'site', width:22 },
    { header:'Date', key:'date', width:14 },
    { header:'Clock in time', key:'clockInTime', width:16 },
    { header:'Clock out time', key:'clockOutTime', width:16 },
    { header:'Total hours', key:'totalHours', width:14 },
    { header:'Hourly rate', key:'hourlyRate', width:14 },
    { header:'Total pay', key:'totalPay', width:14 },
  ];
  rows.forEach(r=>ws.addRow(r));
  ws.getRow(1).font = { bold:true };

  res.setHeader('Content-Type','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="payroll-${siteFilter || 'all-sites'}-${dateLondon(new Date())}.xlsx"`);
  await workbook.xlsx.write(res);
  res.end();
});

app.get('/api/reports/weekly/pdf', adminOnly, (req,res)=>{
  const employees = readJson(EMPLOYEES_FILE, []);
  const logs = readJson(LOGS_FILE, []);
  const { monday, sunday } = weekRangeMondayToSunday(new Date());
  const siteFilter = req.query.site || '';
  const report = employees
    .filter(emp => !siteFilter || emp.site === siteFilter)
    .map(emp => compensationSummaryForEmployee(emp, logs, monday, sunday));

  const doc = new PDFDocument({ margin: 40, size:'A4' });
  const filename = `payroll-${siteFilter || 'all-sites'}-${dateLondon(new Date())}.pdf`;
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  doc.pipe(res);

  doc.fontSize(18).text('ClockFlow Weekly Payroll', { align:'center' });
  doc.moveDown(0.5);
  doc.fontSize(11).text(`Site: ${siteFilter || 'All sites'}`);
  doc.text(`Week: ${dateLondon(monday)} to ${dateLondon(sunday)}`);
  doc.moveDown();

  report.forEach(row => {
    doc.fontSize(12).text(`${row.name} — ${row.site}`, { underline:true });
    doc.fontSize(10).text(`Hours: ${row.totalHoursRaw.toFixed(2)} | Paid: ${row.paidHours.toFixed(2)} | Rate: £${Number(row.compensationRate).toFixed(2)} (${row.compensationType}) | Total pay: £${row.totalPay.toFixed(2)}`);
    doc.text(`Lunch: ${row.lunchMinutes} min | Days worked: ${row.daysWorked}`);
    doc.moveDown(0.8);
  });

  doc.end();
});

app.listen(PORT, '0.0.0.0', ()=> console.log(`ClockFlow PRO running on 0.0.0.0:${PORT}`));
