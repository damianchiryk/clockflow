let sites = [];
let employees = [];
let logsCache = [];
let map;
let logsPage = 1;
let failedPage = 1;

function getAdminPassword() {
  return sessionStorage.getItem('adminPassword') || localStorage.getItem('adminPassword') || '';
}
function adminHeaders(extra = {}) {
  return { ...extra, 'x-admin-password': getAdminPassword() };
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
function qs(id) { return document.getElementById(id); }
function setAdminMessage(text, ok = true) {
  const el = qs('adminMessage');
  el.style.color = ok ? '#8ff0a4' : '#ffb0a9';
  el.textContent = text;
}
function clearEmployeeForm() {
  qs('employeeFormTitle').textContent = 'Add / Edit Employee';
  ['empId','empName','empLogin','empPin','empRate','empLunch','empAdvance'].forEach(id => qs(id).value = '');
  qs('empCompType').value = 'hourly';
  qs('empGeoRequired').checked = true;
  qs('empIsAdmin').checked = false;
  qs('empMustClock').checked = true;
  qs('empMustChangePin').checked = false;
}
function clearManualForm() {
  qs('manualFormTitle').textContent = 'Manual Clock Entry';
  qs('manualLogId').value = '';
  qs('manualAction').value = 'in';
  qs('manualDate').value = new Date().toISOString().slice(0, 10);
  qs('manualTime').value = new Date().toTimeString().slice(0, 5);
  qs('manualNotes').value = '';
}
async function login() {
  const password = qs('adminPassword').value.trim();
  const msg = qs('loginMessage');
  const res = await fetch('/api/admin-login', { method: 'POST', headers: { 'Content-Type':'application/json' }, body: JSON.stringify({ password }) });
  const data = await res.json();
  if (!res.ok) {
    msg.style.color = '#ffb0a9';
    msg.textContent = data.error || 'Login failed';
    return;
  }
  sessionStorage.setItem('adminPassword', password);
  localStorage.setItem('adminPassword', password);
  qs('loginCard').style.display = 'none';
  qs('adminContent').style.display = 'block';
  await initAdmin();
}
async function fetchSites() {
  const res = await fetch('/api/sites', { headers: adminHeaders() });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Failed to load sites');
  sites = data;
  qs('empSite').innerHTML = sites.map(s => `<option value="${s.id}::${s.name}">${s.name}</option>`).join('');
  qs('reportSiteFilter').innerHTML = '<option value="">All sites</option>' + sites.map(s => `<option value="${s.name}">${s.name}</option>`).join('');
}
async function fetchEmployees() {
  const res = await fetch('/api/employees');
  employees = await res.json();
  const body = qs('employeesBody');
  qs('manualEmployee').innerHTML = employees.map(e => `<option value="${e.id}">${e.name}</option>`).join('');
  if (!employees.length) {
    body.innerHTML = '<tr><td colspan="6">No employees</td></tr>';
    return;
  }
  body.innerHTML = employees.map(e => `
    <tr>
      <td>${e.name}${e.isAdmin ? ' <span class="small">(admin)</span>' : ''}</td>
      <td>${e.login || ''}</td>
      <td>${e.site}</td>
      <td>${e.compensationType || e.payType || 'hourly'} £${Number(e.compensationRate ?? e.hourlyRate ?? 0).toFixed(2)}</td>
      <td>${e.mustClock === false ? 'No' : 'Yes'}</td>
      <td class="action-links">
        <button onclick="editEmployee('${e.id}')">Edit</button>
        <button class="delete-btn" onclick="deleteEmployee('${e.id}')">Delete</button>
      </td>
    </tr>
  `).join('');
}
function editEmployee(id) {
  const e = employees.find(x => x.id === id);
  if (!e) return;
  qs('employeeFormTitle').textContent = 'Edit Employee';
  qs('empId').value = e.id;
  qs('empName').value = e.name || '';
  qs('empLogin').value = e.login || '';
  qs('empPin').value = '';
  qs('empRate').value = Number(e.compensationRate ?? e.hourlyRate ?? 0);
  qs('empLunch').value = Number(e.lunchMinutes || 0);
  qs('empAdvance').value = Number(e.advanceBalance || 0);
  qs('empCompType').value = e.compensationType || e.payType || 'hourly';
  qs('empGeoRequired').checked = !!e.geoRequired;
  qs('empIsAdmin').checked = !!e.isAdmin;
  qs('empMustClock').checked = e.mustClock !== false;
  qs('empMustChangePin').checked = !!e.mustChangePin;
  qs('empSite').value = `${e.siteId}::${e.site}`;
  document.getElementById('employeeSection').scrollIntoView({ behavior: 'smooth' });
}
async function saveEmployee() {
  const id = qs('empId').value;
  const siteValue = qs('empSite').value;
  if (!qs('empName').value.trim() || !siteValue || (!id && !qs('empPin').value.trim())) return setAdminMessage('Please fill required fields', false);
  const [siteId, site] = siteValue.split('::');
  const payload = {
    name: qs('empName').value.trim(),
    login: qs('empLogin').value.trim(),
    pin: qs('empPin').value.trim(),
    site, siteId,
    compensationType: qs('empCompType').value,
    compensationRate: Number(qs('empRate').value || 0),
    hourlyRate: Number(qs('empRate').value || 0),
    lunchMinutes: Number(qs('empLunch').value || 0),
    geoRequired: qs('empGeoRequired').checked,
    isAdmin: qs('empIsAdmin').checked,
    mustClock: qs('empMustClock').checked,
    mustChangePin: qs('empMustChangePin').checked,
    advanceBalance: Number(qs('empAdvance').value || 0)
  };
  const url = id ? `/api/employees/${id}` : '/api/employees';
  const method = id ? 'PUT' : 'POST';
  const res = await fetch(url, { method, headers: adminHeaders({ 'Content-Type':'application/json' }), body: JSON.stringify(payload) });
  const data = await res.json();
  if (!res.ok) return setAdminMessage(data.error || 'Save failed', false);
  setAdminMessage(id ? 'Employee updated' : 'Employee created', true);
  clearEmployeeForm();
  await fetchEmployees();
  await fetchReport();
}
async function deleteEmployee(id) {
  if (!confirm('Delete this employee?')) return;
  const res = await fetch(`/api/employees/${id}`, { method: 'DELETE', headers: adminHeaders() });
  const data = await res.json();
  if (!res.ok) return alert(data.error || 'Delete failed');
  await fetchEmployees();
  await fetchReport();
}
async function fetchLogs(page = logsPage) {
  logsPage = page;
  const res = await fetch(`/api/logs?page=${page}`, { headers: adminHeaders() });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Failed to load logs');
  logsCache = data.items || [];
  qs('logsPageInfo').textContent = `Page ${data.pagination.page} of ${data.pagination.totalPages} • ${data.pagination.total} rows`;
  qs('prevLogsBtn').disabled = !data.pagination.hasPrev;
  qs('nextLogsBtn').disabled = !data.pagination.hasNext;
  const body = qs('logsBody');
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
      <td class="action-links"><button onclick="editLog('${log.id}')">Edit</button><button class="delete-btn" onclick="deleteLog('${log.id}')">Delete</button></td>
    </tr>`).join('');
}
function editLog(id) {
  const log = logsCache.find(x => x.id === id);
  if (!log) return;
  qs('manualFormTitle').textContent = 'Edit Clock Entry';
  qs('manualLogId').value = log.id;
  qs('manualEmployee').value = log.employeeId;
  qs('manualAction').value = log.action;
  qs('manualDate').value = dateForInput(log.time);
  qs('manualTime').value = timeForInput(log.time).slice(0,5);
  qs('manualNotes').value = log.notes || '';
  window.scrollTo({ top: 200, behavior: 'smooth' });
}
async function saveManualLog() {
  const payload = { employeeId: qs('manualEmployee').value, action: qs('manualAction').value, date: qs('manualDate').value, time: qs('manualTime').value, notes: qs('manualNotes').value.trim() };
  if (!payload.employeeId || !payload.action || !payload.date || !payload.time) {
    qs('manualMessage').style.color = '#ffb0a9';
    qs('manualMessage').textContent = 'Please fill all required fields';
    return;
  }
  const id = qs('manualLogId').value;
  const url = id ? `/api/logs/${id}` : '/api/manual-log';
  const method = id ? 'PUT' : 'POST';
  const res = await fetch(url, { method, headers: adminHeaders({ 'Content-Type':'application/json' }), body: JSON.stringify(payload) });
  const data = await res.json();
  qs('manualMessage').style.color = res.ok ? '#8ff0a4' : '#ffb0a9';
  qs('manualMessage').textContent = res.ok ? (id ? 'Entry updated' : 'Manual entry added') : (data.error || 'Save failed');
  if (res.ok) {
    clearManualForm();
    await fetchLogs();
    await fetchDashboard();
    await fetchReport();
  }
}
async function deleteLog(id) {
  if (!confirm('Delete this log?')) return;
  const res = await fetch(`/api/logs/${id}`, { method:'DELETE', headers: adminHeaders() });
  const data = await res.json();
  if (!res.ok) return alert(data.error || 'Delete failed');
  await fetchLogs();
  await fetchDashboard();
  await fetchReport();
}
async function fetchFailedAttempts(page = failedPage) {
  failedPage = page;
  const res = await fetch(`/api/failed-attempts?page=${page}`, { headers: adminHeaders() });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Failed to load failed attempts');
  qs('failedPageInfo').textContent = `Page ${data.pagination.page} of ${data.pagination.totalPages} • ${data.pagination.total} rows`;
  qs('prevFailedBtn').disabled = !data.pagination.hasPrev;
  qs('nextFailedBtn').disabled = !data.pagination.hasNext;
  const body = qs('failedBody');
  if (!data.items.length) {
    body.innerHTML = '<tr><td colspan="5">No failed attempts</td></tr>';
    return;
  }
  body.innerHTML = data.items.map(row => `
    <tr>
      <td>${row.name || ''}</td>
      <td>${row.reason || ''}</td>
      <td>${row.action || ''}</td>
      <td>${londonTime(row.time)}</td>
      <td>${row.lat != null ? `${row.lat}, ${row.lng}` : ''}</td>
    </tr>`).join('');
}
async function fetchDashboard() {
  const res = await fetch('/api/dashboard/today', { headers: adminHeaders() });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Failed to load dashboard');
  const rows = data.employees || [];
  const body = qs('dashboardBody');
  body.innerHTML = rows.length ? rows.map(row => `
    <tr>
      <td>${row.name}</td>
      <td>${row.site}</td>
      <td>${Number(row.todayHours || 0).toFixed(2)}</td>
      <td class="${row.currentlyClockedIn ? 'status-open' : 'status-closed'}">${row.currentlyClockedIn ? 'Clocked in' : 'Clocked out'}</td>
      <td>${row.firstIn || ''}</td>
      <td>${row.lastOut || ''}</td>
    </tr>`).join('') : '<tr><td colspan="6">No data</td></tr>';
}
async function fetchReport() {
  const site = qs('reportSiteFilter').value;
  const url = site ? `/api/reports/weekly?site=${encodeURIComponent(site)}` : '/api/reports/weekly';
  const res = await fetch(url, { headers: adminHeaders() });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Failed to load report');
  const report = data.report || [];
  const body = qs('reportBody');
  body.innerHTML = report.length ? report.map(row => `
    <tr>
      <td>${row.name}</td>
      <td>${row.site}</td>
      <td>${row.compensationType}</td>
      <td>£${Number(row.compensationRate || 0).toFixed(2)}</td>
      <td>${Number(row.lunchMinutes || 0)} min</td>
      <td>${Number(row.totalHoursRaw || 0).toFixed(2)}</td>
      <td>£${Number(row.advanceBalance || 0).toFixed(2)}</td>
      <td>£${Number(row.totalPay || 0).toFixed(2)}</td>
    </tr>`).join('') : '<tr><td colspan="8">No report yet</td></tr>';
}
function downloadExcel() {
  const site = qs('reportSiteFilter').value;
  const qs1 = site ? `?site=${encodeURIComponent(site)}` : '';
  const password = encodeURIComponent(getAdminPassword());
  window.open(`/api/reports/weekly/excel${qs1}${qs1 ? '&' : '?'}adminPassword=${password}`, '_blank');
}
function downloadPdf() {
  const site = qs('reportSiteFilter').value;
  const qs1 = site ? `?site=${encodeURIComponent(site)}` : '';
  const password = encodeURIComponent(getAdminPassword());
  window.open(`/api/reports/weekly/pdf${qs1}${qs1 ? '&' : '?'}adminPassword=${password}`, '_blank');
}
function downloadBackup() {
  const password = encodeURIComponent(getAdminPassword());
  window.open(`/api/admin/backup/download?adminPassword=${password}`, '_blank');
}
async function initMap() {
  if (!map) {
    map = L.map('map').setView([51.48, 0.39], 11);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19 }).addTo(map);
  }
  map.eachLayer(layer => { if (!(layer instanceof L.TileLayer)) map.removeLayer(layer); });
  sites.forEach(site => {
    if (site.lat == null || site.lng == null) return;
    L.marker([site.lat, site.lng]).addTo(map).bindPopup(`<b>${site.name}</b><br>${site.address || ''}`);
    L.circle([site.lat, site.lng], { radius: site.radiusMeters || 50, color:'#3d72f4', fillOpacity:0.08 }).addTo(map);
  });
  const res = await fetch('/api/map/logs', { headers: adminHeaders() });
  const points = await res.json();
  points.forEach(p => {
    const m = L.circleMarker([p.lat, p.lng], { radius: 8, color: p.type === 'failed' ? 'red' : 'green' }).addTo(map);
    m.bindPopup(`<b>${p.name}</b><br>${p.type === 'failed' ? (p.reason || '') : `${p.action}` }<br>${londonTime(p.time)}`);
  });
  setTimeout(() => map.invalidateSize(), 100);
}
async function initAdmin() {
  await fetchSites();
  await fetchEmployees();
  clearEmployeeForm();
  clearManualForm();
  await fetchLogs(1);
  await fetchFailedAttempts(1);
  await fetchDashboard();
  await fetchReport();
  await initMap();
}

document.getElementById('loginBtn').addEventListener('click', login);
document.getElementById('saveEmployeeBtn').addEventListener('click', saveEmployee);
document.getElementById('cancelEmployeeBtn').addEventListener('click', clearEmployeeForm);
document.getElementById('refreshEmployeesBtn').addEventListener('click', fetchEmployees);
document.getElementById('saveManualBtn').addEventListener('click', saveManualLog);
document.getElementById('cancelManualBtn').addEventListener('click', clearManualForm);
document.getElementById('refreshLogsBtn').addEventListener('click', () => fetchLogs(logsPage));
document.getElementById('prevLogsBtn').addEventListener('click', () => fetchLogs(logsPage - 1));
document.getElementById('nextLogsBtn').addEventListener('click', () => fetchLogs(logsPage + 1));
document.getElementById('refreshFailedBtn').addEventListener('click', () => fetchFailedAttempts(failedPage));
document.getElementById('prevFailedBtn').addEventListener('click', () => fetchFailedAttempts(failedPage - 1));
document.getElementById('nextFailedBtn').addEventListener('click', () => fetchFailedAttempts(failedPage + 1));
document.getElementById('refreshDashboardBtn').addEventListener('click', fetchDashboard);
document.getElementById('refreshReportBtn').addEventListener('click', fetchReport);
document.getElementById('excelBtn').addEventListener('click', downloadExcel);
document.getElementById('pdfBtn').addEventListener('click', downloadPdf);
document.getElementById('backupBtn').addEventListener('click', downloadBackup);
document.getElementById('refreshMapBtn').addEventListener('click', initMap);
document.querySelectorAll('[data-section-target]').forEach(btn => btn.addEventListener('click', () => document.getElementById(btn.dataset.sectionTarget).scrollIntoView({ behavior:'smooth' })));

window.addEventListener('DOMContentLoaded', async () => {
  const saved = getAdminPassword();
  if (saved) {
    qs('loginCard').style.display = 'none';
    qs('adminContent').style.display = 'block';
    try { await initAdmin(); }
    catch { sessionStorage.removeItem('adminPassword'); localStorage.removeItem('adminPassword'); qs('loginCard').style.display = 'block'; qs('adminContent').style.display = 'none'; }
  } else clearManualForm();
});
