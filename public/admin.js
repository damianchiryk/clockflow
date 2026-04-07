let sites = [];
let employees = [];
let logsCache = [];
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
  const manual = document.getElementById('manualEmployee');
  const docsEmployee = document.getElementById('docsEmployee');
  const options = employees.map(e => `<option value="${e.id}">${e.name}</option>`).join('');
  manual.innerHTML = options;
  docsEmployee.innerHTML = options;
  if (!employees.length) {
    body.innerHTML = '<tr><td colspan="7">No employees</td></tr>';
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
  window.scrollTo({ top: 0, behavior: 'smooth' });
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
  if (!logsCache.length) {
    body.innerHTML = '<tr><td colspan="7">No logs yet</td></tr>';
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
  window.scrollTo({ top: 320, behavior: 'smooth' });
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
  const data = await apiJson('/api/failed-attempts');
  const body = document.getElementById('failedBody');
  if (!data.length) {
    body.innerHTML = '<tr><td colspan="5">No failed attempts</td></tr>';
    return;
  }
  body.innerHTML = data.map(row => `
    <tr>
      <td>${row.name || ''}</td>
      <td>${row.reason || ''}</td>
      <td>${row.action || ''}</td>
      <td>${londonTime(row.time)}</td>
      <td>${row.lat != null ? `${row.lat}, ${row.lng}` : ''}</td>
    </tr>
  `).join('');
}
async function fetchDashboard() {
  const data = await apiJson('/api/dashboard/today');
  const rows = data.employees || [];
  const body = document.getElementById('dashboardBody');
  if (!rows.length) {
    body.innerHTML = '<tr><td colspan="6">No data</td></tr>';
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
}
async function fetchReport() {
  const site = document.getElementById('reportSiteFilter').value;
  const url = site ? `/api/reports/weekly?site=${encodeURIComponent(site)}` : '/api/reports/weekly';
  const data = await apiJson(url);
  const report = data.report || [];
  const body = document.getElementById('reportBody');
  if (!report.length) {
    body.innerHTML = '<tr><td colspan="8">No report yet</td></tr>';
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
}
function tokenQuery() {
  const token = encodeURIComponent(getAdminToken());
  return `adminToken=${token}`;
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
async function initMap() {
  const mapEl = document.getElementById('map');
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
  if (!employeeId) {
    body.innerHTML = '<tr><td colspan="4">No documents</td></tr>';
    return;
  }
  try {
    const data = await apiJson(`/api/employee-documents/${employeeId}`);
    const docs = data.documents || [];
    if (!docs.length) {
      body.innerHTML = '<tr><td colspan="4">No documents</td></tr>';
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
  } catch (e) {
    body.innerHTML = `<tr><td colspan="4">${e.message || 'Failed to load documents'}</td></tr>`;
  }
}
function viewDocuments(employeeId) {
  document.getElementById('docsEmployee').value = employeeId;
  fetchDocuments();
  window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' });
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

window.addEventListener('DOMContentLoaded', async () => {
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

window.editEmployee = editEmployee;
window.deleteEmployee = deleteEmployee;
window.editLog = editLog;
window.deleteLog = deleteLog;
window.viewDocuments = viewDocuments;
