let sites = [];
let employees = [];
let logsCache = [];
let failedCache = [];
let dashboardCache = [];
let reportCache = [];
let documentsCache = [];
let map;
let mapLayers = [];

function getAdminToken() {
  return sessionStorage.getItem('adminToken') || localStorage.getItem('adminToken') || '';
}
function adminHeaders(extra = {}) {
  const token = getAdminToken();
  return token ? { ...extra, 'x-admin-token': token } : extra;
}
function londonTime(value) {
  return new Date(value).toLocaleString('en-GB', {
    timeZone: 'Europe/London',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit'
  });
}
function dateForInput(value) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(value));
}
function timeForInput(value) {
  return new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(value));
}
function showMessage(id, text, ok = false) {
  const el = document.getElementById(id);
  if (!el) return;
  el.style.color = ok ? '#8ff0a4' : '#ffb0a9';
  el.textContent = text;
}
function logoutAdmin() {
  sessionStorage.removeItem('adminToken');
  localStorage.removeItem('adminToken');
  document.getElementById('loginCard').style.display = 'block';
  document.getElementById('adminContent').style.display = 'none';
  document.getElementById('adminPassword').value = '';
}
function clearEmployeeForm() {
  document.getElementById('employeeFormTitle').textContent = 'Add / Edit Employee';
  document.getElementById('empId').value = '';
  document.getElementById('empName').value = '';
  document.getElementById('empLogin').value = '';
  document.getElementById('empPin').value = '';
  document.getElementById('empRate').value = '';
  document.getElementById('empLunch').value = '';
  document.getElementById('empAdvance').value = '';
  document.getElementById('empCompType').value = 'hourly';
  document.getElementById('empGeoRequired').checked = true;
  document.getElementById('empMustClock').checked = true;
  document.getElementById('empMustChangePin').checked = true;
  document.getElementById('empIsAdmin').checked = false;
  document.getElementById('adminMessage').textContent = '';
}
function clearManualForm() {
  document.getElementById('manualFormTitle').textContent = 'Manual Clock Entry';
  document.getElementById('manualLogId').value = '';
  document.getElementById('manualAction').value = 'in';
  document.getElementById('manualDate').value = dateForInput(new Date());
  document.getElementById('manualTime').value = timeForInput(new Date()).slice(0, 5);
  document.getElementById('manualNotes').value = '';
  document.getElementById('manualMessage').textContent = '';
}
async function apiJson(url, options = {}) {
  const res = await fetch(url, { ...options, headers: adminHeaders(options.headers || {}) });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Request failed');
  return data;
}
function isMobileAdmin() {
  return window.innerWidth <= 768;
}
function tokenQuery() {
  const token = encodeURIComponent(getAdminToken());
  return `adminToken=${token}`;
}
function setActiveView(view) {
  document.querySelectorAll('.view-section').forEach(el => el.classList.remove('active'));
  const current = document.getElementById(`view-${view}`);
  if (current) current.classList.add('active');
  document.querySelectorAll('.admin-tab').forEach(btn => btn.classList.toggle('active', btn.dataset.view === view));
  localStorage.setItem('clockflowAdminView', view);
  if (view === 'map') setTimeout(() => map?.invalidateSize(), 150);
  window.scrollTo({ top: 0, behavior: 'smooth' });
}
function setupNavigation() {
  document.querySelectorAll('.admin-tab').forEach(btn => {
    btn.addEventListener('click', () => setActiveView(btn.dataset.view));
  });
  document.querySelectorAll('[data-view-target]').forEach(btn => {
    btn.addEventListener('click', () => setActiveView(btn.dataset.viewTarget));
  });
}
function cardRow(label, value, cls = '') {
  return `<div class="card-row ${cls}"><span>${label}</span><strong>${value}</strong></div>`;
}
function cardActions(actions) {
  return `<div class="card-actions">${actions.join('')}</div>`;
}
function employeeCard(e) {
  return `
    <div class="app-card">
      <div class="app-card-title-row">
        <div>
          <div class="app-card-title">${e.name}</div>
          <div class="small">${e.login || ''}${e.isAdmin ? ' • admin' : ''}</div>
        </div>
        <span class="pill ${e.mustClock === false ? 'pill-muted' : 'pill-blue'}">${e.mustClock === false ? 'No clock' : 'Clock'}</span>
      </div>
      ${cardRow('Site', e.site || '')}
      ${cardRow('Pay', `${e.compensationType || 'hourly'} £${Number(e.compensationRate ?? 0).toFixed(2)}`)}
      ${cardRow('Advance', `£${Number(e.advanceBalance || 0).toFixed(2)}`)}
      ${cardActions([
        `<button class="mini-btn" onclick="editEmployee('${e.id}')">Edit</button>`,
        `<button class="mini-btn" onclick="viewDocuments('${e.id}')">Docs</button>`,
        `<button class="mini-btn mini-btn-danger" onclick="deleteEmployee('${e.id}')">Delete</button>`
      ])}
    </div>`;
}
function dashboardCard(row) {
  const status = row.mustClock === false ? 'No clock required' : row.currentlyClockedIn ? 'Clocked in' : 'Clocked out';
  return `
    <div class="app-card">
      <div class="app-card-title-row">
        <div class="app-card-title">${row.name}</div>
        <span class="pill ${row.currentlyClockedIn ? 'pill-green' : 'pill-muted'}">${status}</span>
      </div>
      ${cardRow('Site', row.site || '')}
      ${cardRow('Hours', Number(row.todayHours || 0).toFixed(2))}
      ${row.firstIn ? cardRow('First in', row.firstIn) : ''}
      ${row.lastOut ? cardRow('Last out', row.lastOut) : ''}
    </div>`;
}
function logCard(log) {
  return `
    <div class="app-card">
      <div class="app-card-title-row">
        <div class="app-card-title">${log.name}</div>
        <span class="pill ${log.action === 'in' ? 'pill-green' : 'pill-red'}">${String(log.action || '').toUpperCase()}</span>
      </div>
      ${cardRow('Site', log.site || '')}
      ${cardRow('Time', londonTime(log.time))}
      ${cardRow('GPS', log.geo?.required ? (log.geo.allowed ? `OK (${log.geo.distanceMeters ?? '-'}m)` : 'Blocked') : 'Bypass')}
      ${cardRow('Source', log.source || 'mobile')}
      ${cardActions([
        `<button class="mini-btn" onclick="editLog('${log.id}')">Edit</button>`,
        `<button class="mini-btn mini-btn-danger" onclick="deleteLog('${log.id}')">Delete</button>`
      ])}
    </div>`;
}
function failedCard(row) {
  return `
    <div class="app-card">
      <div class="app-card-title">${row.name || 'Unknown'}</div>
      ${cardRow('Reason', row.reason || '')}
      ${cardRow('Action', row.action || '')}
      ${cardRow('Time', londonTime(row.time))}
      ${row.lat != null ? cardRow('GPS', `${row.lat}, ${row.lng}`) : ''}
    </div>`;
}
function reportCard(row) {
  return `
    <div class="app-card">
      <div class="app-card-title-row">
        <div class="app-card-title">${row.name}</div>
        <span class="pill pill-blue">£${Number(row.totalPay || 0).toFixed(2)}</span>
      </div>
      ${cardRow('Site', row.site)}
      ${cardRow('Type', row.compensationType)}
      ${cardRow('Rate', `£${Number(row.compensationRate || 0).toFixed(2)}`)}
      ${cardRow('Hours', Number(row.paidHours || 0).toFixed(2))}
      ${cardRow('Gross', `£${Number(row.grossPay || 0).toFixed(2)}`)}
      ${cardRow('Advance', `£${Number(row.advanceDeduction || 0).toFixed(2)}`)}
    </div>`;
}
function docCard(employeeId, doc) {
  return `
    <div class="app-card">
      <div class="app-card-title">${doc.fileName || ''}</div>
      ${cardRow('Type', doc.docType || '')}
      ${cardRow('Uploaded', doc.uploadedAtLocal || londonTime(doc.uploadedAt))}
      <div class="card-actions"><a class="mini-btn" href="/api/employee-document/${employeeId}/${doc.id}?${tokenQuery()}" target="_blank">Open</a></div>
    </div>`;
}
async function login() {
  try {
    const password = document.getElementById('adminPassword').value.trim();
    const res = await fetch('/api/admin-login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Login failed');
    sessionStorage.setItem('adminToken', data.token);
    localStorage.setItem('adminToken', data.token);
    document.getElementById('loginCard').style.display = 'none';
    document.getElementById('adminContent').style.display = 'block';
    await initAdmin();
  } catch (e) {
    showMessage('loginMessage', e.message || 'Login failed');
  }
}

async function fetchSites() {
  sites = await apiJson('/api/sites');
  const options = sites.map(site => `<option value="${site.id}::${site.name}">${site.name}</option>`).join('');
  document.getElementById('empSite').innerHTML = options;
  const filter = document.getElementById('reportSiteFilter');
  filter.innerHTML = '<option value="">All sites</option>' + sites.map(site => `<option value="${site.name}">${site.name}</option>`).join('');
}
async function fetchEmployees() {
  const res = await fetch('/api/employees');
  employees = await res.json();
  const body = document.getElementById('employeesBody');
  const cards = document.getElementById('employeesCards');
  const manual = document.getElementById('manualEmployee');
  const docsEmployee = document.getElementById('docsEmployee');
  const options = employees.map(e => `<option value="${e.id}">${e.name}</option>`).join('');
  manual.innerHTML = options;
  docsEmployee.innerHTML = options;
  if (!employees.length) {
    body.innerHTML = '<tr><td colspan="7">No employees</td></tr>';
    cards.innerHTML = '<div class="empty-card">No employees</div>';
    return;
  }
  body.innerHTML = employees.map(e => `
    <tr>
      <td>${e.name}${e.isAdmin ? ' <span class="small">(admin)</span>' : ''}</td>
      <td>${e.login || ''}${e.mustChangePin ? ' <span class="small">(PIN change)</span>' : ''}</td>
      <td>${e.site}</td>
      <td>${e.compensationType} £${Number(e.compensationRate ?? 0).toFixed(2)}</td>
      <td>${e.mustClock === false ? 'No' : 'Yes'}</td>
      <td>£${Number(e.advanceBalance || 0).toFixed(2)}</td>
      <td class="action-links">
        <button onclick="editEmployee('${e.id}')">Edit</button>
        <button onclick="viewDocuments('${e.id}')">Docs</button>
        <button class="delete-btn" onclick="deleteEmployee('${e.id}')">Delete</button>
      </td>
    </tr>
  `).join('');
  cards.innerHTML = employees.map(employeeCard).join('');
}
function editEmployee(id) {
  const e = employees.find(x => x.id === id);
  if (!e) return;
  document.getElementById('employeeFormTitle').textContent = 'Edit Employee';
  document.getElementById('empId').value = e.id;
  document.getElementById('empName').value = e.name || '';
  document.getElementById('empLogin').value = e.login || '';
  document.getElementById('empPin').value = '';
  document.getElementById('empRate').value = Number(e.compensationRate ?? e.hourlyRate ?? 0);
  document.getElementById('empLunch').value = Number(e.lunchMinutes || 0);
  document.getElementById('empAdvance').value = Number(e.advanceBalance || 0);
  document.getElementById('empCompType').value = e.compensationType || 'hourly';
  document.getElementById('empGeoRequired').checked = !!e.geoRequired;
  document.getElementById('empMustClock').checked = e.mustClock !== false;
  document.getElementById('empMustChangePin').checked = !!e.mustChangePin;
  document.getElementById('empIsAdmin').checked = !!e.isAdmin;
  document.getElementById('empSite').value = `${e.siteId}::${e.site}`;
  setActiveView('employee-form');
}
async function saveEmployee() {
  const id = document.getElementById('empId').value;
  const name = document.getElementById('empName').value.trim();
  const login = document.getElementById('empLogin').value.trim();
  const pin = document.getElementById('empPin').value.trim();
  const siteValue = document.getElementById('empSite').value;
  const rate = document.getElementById('empRate').value;
  const lunch = document.getElementById('empLunch').value;
  const advance = document.getElementById('empAdvance').value;
  const compType = document.getElementById('empCompType').value;
  const geoRequired = document.getElementById('empGeoRequired').checked;
  const mustClock = document.getElementById('empMustClock').checked;
  const mustChangePin = document.getElementById('empMustChangePin').checked;
  const isAdmin = document.getElementById('empIsAdmin').checked;
  if (!name || !siteValue || !login || (!id && !pin)) {
    showMessage('adminMessage', 'Please fill required fields');
    return;
  }
  const [siteId, site] = siteValue.split('::');
  const payload = {
    name, login, site, siteId,
    hourlyRate: Number(rate || 0),
    compensationType: compType,
    compensationRate: Number(rate || 0),
    lunchMinutes: Number(lunch || 0),
    advanceBalance: Number(advance || 0),
    geoRequired, mustClock, mustChangePin, isAdmin
  };
  if (pin) payload.pin = pin;
  const url = id ? `/api/employees/${id}` : '/api/employees';
  const method = id ? 'PUT' : 'POST';
  try {
    await apiJson(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    showMessage('adminMessage', id ? 'Employee updated' : 'Employee created', true);
    clearEmployeeForm();
    await fetchEmployees();
    await fetchReport();
    setActiveView('employees');
  } catch (e) {
    showMessage('adminMessage', e.message || 'Save failed');
  }
}
async function deleteEmployee(id) {
  if (!confirm('Delete this employee?')) return;
  try {
    await apiJson(`/api/employees/${id}`, { method: 'DELETE' });
    await fetchEmployees();
    await fetchReport();
    await fetchDocuments();
  } catch (e) {
    alert(e.message || 'Delete failed');
  }
}

async function fetchLogs() {
  logsCache = await apiJson('/api/logs');
  const body = document.getElementById('logsBody');
  const cards = document.getElementById('logsCards');
  if (!logsCache.length) {
    body.innerHTML = '<tr><td colspan="7">No logs yet</td></tr>';
    cards.innerHTML = '<div class="empty-card">No logs yet</div>';
    return;
  }
  body.innerHTML = logsCache.map(log => `
    <tr>
      <td>${log.name}</td>
      <td>${log.site || ''}</td>
      <td><span class="badge ${log.action}">${String(log.action).toUpperCase()}</span></td>
      <td>${londonTime(log.time)}</td>
      <td>${log.geo?.required ? (log.geo.allowed ? `OK (${log.geo.distanceMeters ?? '-'}m)` : 'Blocked') : 'Bypass'}</td>
      <td>${log.source || 'mobile'}</td>
      <td class="action-links">
        <button onclick="editLog('${log.id}')">Edit</button>
        <button class="delete-btn" onclick="deleteLog('${log.id}')">Delete</button>
      </td>
    </tr>
  `).join('');
  cards.innerHTML = logsCache.map(logCard).join('');
}
function editLog(id) {
  const log = logsCache.find(x => x.id === id);
  if (!log) return;
  document.getElementById('manualFormTitle').textContent = 'Edit Clock Entry';
  document.getElementById('manualLogId').value = log.id;
  document.getElementById('manualEmployee').value = log.employeeId;
  document.getElementById('manualAction').value = log.action;
  document.getElementById('manualDate').value = dateForInput(log.time);
  document.getElementById('manualTime').value = timeForInput(log.time).slice(0, 5);
  document.getElementById('manualNotes').value = log.notes || '';
  setActiveView('employee-form');
}
async function saveManualLog() {
  const id = document.getElementById('manualLogId').value;
  const employeeId = document.getElementById('manualEmployee').value;
  const action = document.getElementById('manualAction').value;
  const date = document.getElementById('manualDate').value;
  const time = document.getElementById('manualTime').value;
  const notes = document.getElementById('manualNotes').value.trim();
  if (!employeeId || !action || !date || !time) {
    showMessage('manualMessage', 'Please fill all required fields');
    return;
  }
  const payload = { employeeId, action, date, time, notes };
  const url = id ? `/api/logs/${id}` : '/api/manual-log';
  const method = id ? 'PUT' : 'POST';
  try {
    await apiJson(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    showMessage('manualMessage', id ? 'Entry updated' : 'Manual entry added', true);
    clearManualForm();
    await fetchLogs();
    await fetchDashboard();
    await fetchReport();
    await initMap();
    setActiveView('today');
  } catch (e) {
    showMessage('manualMessage', e.message || 'Save failed');
  }
}
async function deleteLog(id) {
  if (!confirm('Delete this log?')) return;
  try {
    await apiJson(`/api/logs/${id}`, { method: 'DELETE' });
    await fetchLogs();
    await fetchDashboard();
    await fetchReport();
    await initMap();
  } catch (e) {
    alert(e.message || 'Delete failed');
  }
}
async function fetchFailedAttempts() {
  failedCache = await apiJson('/api/failed-attempts');
  const body = document.getElementById('failedBody');
  const cards = document.getElementById('failedCards');
  if (!failedCache.length) {
    body.innerHTML = '<tr><td colspan="5">No failed attempts</td></tr>';
    cards.innerHTML = '<div class="empty-card">No failed attempts</div>';
    return;
  }
  body.innerHTML = failedCache.map(row => `
    <tr>
      <td>${row.name || ''}</td>
      <td>${row.reason || ''}</td>
      <td>${row.action || ''}</td>
      <td>${londonTime(row.time)}</td>
      <td>${row.lat != null ? `${row.lat}, ${row.lng}` : ''}</td>
    </tr>
  `).join('');
  cards.innerHTML = failedCache.map(failedCard).join('');
}
async function fetchDashboard() {
  const data = await apiJson('/api/dashboard/today');
  dashboardCache = data.employees || [];
  const rows = dashboardCache;
  const body = document.getElementById('dashboardBody');
  const cards = document.getElementById('dashboardCards');
  if (!rows.length) {
    body.innerHTML = '<tr><td colspan="6">No data</td></tr>';
    cards.innerHTML = '<div class="empty-card">No data</div>';
    return;
  }
  body.innerHTML = rows.map(row => `
    <tr>
      <td>${row.name}</td>
      <td>${row.site}</td>
      <td>${Number(row.todayHours || 0).toFixed(2)}</td>
      <td class="${row.currentlyClockedIn ? 'status-open' : 'status-closed'}">${row.mustClock === false ? 'No clock required' : row.currentlyClockedIn ? 'Clocked in' : 'Clocked out'}</td>
      <td>${row.firstIn || ''}</td>
      <td>${row.lastOut || ''}</td>
    </tr>
  `).join('');
  cards.innerHTML = rows.map(dashboardCard).join('');
  const clockedIn = rows.filter(r => r.currentlyClockedIn).length;
  const noClock = rows.filter(r => r.mustClock === false).length;
  const clockedOut = rows.length - clockedIn - noClock;
  const totalHours = rows.reduce((sum, r) => sum + Number(r.todayHours || 0), 0);
  document.getElementById('statClockedIn').textContent = String(clockedIn);
  document.getElementById('statClockedOut').textContent = String(clockedOut);
  document.getElementById('statNoClock').textContent = String(noClock);
  document.getElementById('statHoursToday').textContent = totalHours.toFixed(2);
}
async function fetchReport() {
  const site = document.getElementById('reportSiteFilter').value;
  const url = site ? `/api/reports/weekly?site=${encodeURIComponent(site)}` : '/api/reports/weekly';
  const data = await apiJson(url);
  reportCache = data.report || [];
  const report = reportCache;
  const body = document.getElementById('reportBody');
  const cards = document.getElementById('reportCards');
  if (!report.length) {
    body.innerHTML = '<tr><td colspan="8">No report yet</td></tr>';
    cards.innerHTML = '<div class="empty-card">No report yet</div>';
    return;
  }
  body.innerHTML = report.map(row => `
    <tr>
      <td>${row.name}</td>
      <td>${row.site}</td>
      <td>${row.compensationType}</td>
      <td>£${Number(row.compensationRate || 0).toFixed(2)}</td>
      <td>${Number(row.paidHours || 0).toFixed(2)}</td>
      <td>£${Number(row.grossPay || 0).toFixed(2)}</td>
      <td>£${Number(row.advanceDeduction || 0).toFixed(2)}</td>
      <td>£${Number(row.totalPay || 0).toFixed(2)}</td>
    </tr>
  `).join('');
  cards.innerHTML = report.map(reportCard).join('');
}
function downloadExcel() {
  const site = document.getElementById('reportSiteFilter').value;
  const qs = site ? `?site=${encodeURIComponent(site)}&${tokenQuery()}` : `?${tokenQuery()}`;
  window.open(`/api/reports/weekly/excel${qs}`, '_blank');
}
function downloadPdf() {
  const site = document.getElementById('reportSiteFilter').value;
  const qs = site ? `?site=${encodeURIComponent(site)}&${tokenQuery()}` : `?${tokenQuery()}`;
  window.open(`/api/reports/weekly/pdf${qs}`, '_blank');
}
function downloadBackup() {
  const payload = {
    employees,
    sites,
    logs: logsCache,
    failedAttempts: failedCache,
    dashboard: dashboardCache,
    report: reportCache,
    exportedAt: new Date().toISOString()
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `clockflow-backup-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
async function initMap() {
  if (!map) {
    map = L.map('map');
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19 }).addTo(map);
  }
  mapLayers.forEach(layer => map.removeLayer(layer));
  mapLayers = [];

  const bounds = [];
  sites.forEach(site => {
    const lat = Number(site.lat);
    const lng = Number(site.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
    const marker = L.marker([lat, lng]).addTo(map);
    marker.bindPopup(`<b>${site.name}</b><br>${site.address || ''}`);
    const circle = L.circle([lat, lng], { radius: Number(site.radiusMeters || 200), color: '#3d72f4', fillOpacity: 0.08 }).addTo(map);
    mapLayers.push(marker, circle);
    bounds.push([lat, lng]);
  });

  const points = await apiJson('/api/map/logs');
  points.forEach(p => {
    const lat = Number(p.lat);
    const lng = Number(p.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
    const color = p.type === 'failed' ? 'red' : 'green';
    const m = L.circleMarker([lat, lng], { radius: 8, color }).addTo(map);
    const detail = p.type === 'failed' ? (p.reason || '') : `${p.name} ${String(p.action).toUpperCase()}`;
    m.bindPopup(`<b>${p.name}</b><br>${detail}<br>${londonTime(p.time)}`);
    mapLayers.push(m);
    bounds.push([lat, lng]);
  });

  if (bounds.length) map.fitBounds(bounds, { padding: [30, 30] });
  else map.setView([51.48, 0.39], 11);
  setTimeout(() => map.invalidateSize(), 50);
  setTimeout(() => map.invalidateSize(), 250);
}
async function fetchDocuments() {
  const employeeId = document.getElementById('docsEmployee').value;
  const body = document.getElementById('docsBody');
  const cards = document.getElementById('docsCards');
  if (!employeeId) {
    body.innerHTML = '<tr><td colspan="4">No documents</td></tr>';
    cards.innerHTML = '<div class="empty-card">No documents</div>';
    return;
  }
  try {
    const data = await apiJson(`/api/employee-documents/${employeeId}`);
    const docs = data.documents || [];
    documentsCache = docs;
    if (!docs.length) {
      body.innerHTML = '<tr><td colspan="4">No documents</td></tr>';
      cards.innerHTML = '<div class="empty-card">No documents</div>';
      return;
    }
    body.innerHTML = docs.map(doc => `
      <tr>
        <td>${doc.docType || ''}</td>
        <td>${doc.fileName || ''}</td>
        <td>${doc.uploadedAtLocal || londonTime(doc.uploadedAt)}</td>
        <td><a class="link-inline" href="/api/employee-document/${employeeId}/${doc.id}?${tokenQuery()}" target="_blank">Open</a></td>
      </tr>
    `).join('');
    cards.innerHTML = docs.map(doc => docCard(employeeId, doc)).join('');
  } catch (e) {
    body.innerHTML = `<tr><td colspan="4">${e.message || 'Failed to load documents'}</td></tr>`;
    cards.innerHTML = `<div class="empty-card">${e.message || 'Failed to load documents'}</div>`;
  }
}
function viewDocuments(employeeId) {
  document.getElementById('docsEmployee').value = employeeId;
  fetchDocuments();
  setActiveView('documents');
}
async function initAdmin() {
  await fetchSites();
  await fetchEmployees();
  clearEmployeeForm();
  clearManualForm();
  await fetchLogs();
  await fetchFailedAttempts();
  await fetchDashboard();
  await fetchReport();
  await fetchDocuments();
  await initMap();
  setActiveView(localStorage.getItem('clockflowAdminView') || 'today');
}

document.getElementById('loginBtn').addEventListener('click', login);
document.getElementById('logoutBtn').addEventListener('click', logoutAdmin);
document.getElementById('saveEmployeeBtn').addEventListener('click', saveEmployee);
document.getElementById('cancelEmployeeBtn').addEventListener('click', clearEmployeeForm);
document.getElementById('refreshEmployeesBtn').addEventListener('click', fetchEmployees);
document.getElementById('saveManualBtn').addEventListener('click', saveManualLog);
document.getElementById('cancelManualBtn').addEventListener('click', clearManualForm);
document.getElementById('refreshLogsBtn').addEventListener('click', fetchLogs);
document.getElementById('refreshFailedBtn').addEventListener('click', fetchFailedAttempts);
document.getElementById('refreshDashboardBtn').addEventListener('click', fetchDashboard);
document.getElementById('refreshReportBtn').addEventListener('click', fetchReport);
document.getElementById('excelBtn').addEventListener('click', downloadExcel);
document.getElementById('pdfBtn').addEventListener('click', downloadPdf);
document.getElementById('refreshMapBtn').addEventListener('click', initMap);
document.getElementById('docsEmployee').addEventListener('change', fetchDocuments);
document.getElementById('refreshDocsBtn').addEventListener('click', fetchDocuments);
document.getElementById('backupAllBtn').addEventListener('click', downloadBackup);
const mobileBackup = document.getElementById('backupAllBtnMobile');
if (mobileBackup) mobileBackup.addEventListener('click', downloadBackup);

window.addEventListener('DOMContentLoaded', async () => {
  setupNavigation();
  const savedToken = getAdminToken();
  if (savedToken) {
    document.getElementById('loginCard').style.display = 'none';
    document.getElementById('adminContent').style.display = 'block';
    try {
      await initAdmin();
    } catch {
      logoutAdmin();
    }
  } else {
    clearManualForm();
  }
});

window.addEventListener('resize', () => {
  fetchEmployees();
  fetchDashboard();
  fetchLogs();
  fetchFailedAttempts();
  fetchReport();
  fetchDocuments();
  if (map) setTimeout(() => map.invalidateSize(), 100);
});

window.editEmployee = editEmployee;
window.deleteEmployee = deleteEmployee;
window.editLog = editLog;
window.deleteLog = deleteLog;
window.viewDocuments = viewDocuments;
