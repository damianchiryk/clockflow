let sites = [];
let employees = [];

async function fetchSites() {
  const res = await fetch('/api/sites');
  sites = await res.json();
  const select = document.getElementById('empSite');
  select.innerHTML = `
    <option value="vrs-east-tilbury::VRS Mechanical">VRS Mechanical</option>
    <option value="vrs-east-tilbury::VRS Bodyshop">VRS Bodyshop</option>
    <option value="alk-grays::ALK Bodyshop">ALK Bodyshop</option>
  `;
}

async function fetchEmployees() {
  const res = await fetch('/api/employees');
  employees = await res.json();

  const body = document.getElementById('employeesBody');
  if (!employees.length) {
    body.innerHTML = '<tr><td colspan="5">No employees</td></tr>';
    return;
  }

  body.innerHTML = employees.map(e => `
    <tr>
      <td>${e.name}${e.isAdmin ? ' <span class="small">(admin)</span>' : ''}</td>
      <td>${e.site}</td>
      <td>£${Number(e.hourlyRate || 0).toFixed(2)}</td>
      <td>${Number(e.lunchMinutes || 0)} min</td>
      <td>${e.geoRequired ? 'Required' : 'Bypass'}</td>
    </tr>
  `).join('');
}

async function fetchLogs() {
  const res = await fetch('/api/logs');
  const logs = await res.json();

  const body = document.getElementById('logsBody');
  if (!logs.length) {
    body.innerHTML = '<tr><td colspan="5">No logs yet</td></tr>';
    return;
  }

  body.innerHTML = logs.map(log => `
    <tr>
      <td>${log.name}</td>
      <td>${log.site || ''}</td>
      <td><span class="badge ${log.action}">${String(log.action).toUpperCase()}</span></td>
      <td>${log.localTime || new Date(log.time).toLocaleString()}</td>
      <td>${log.geo?.required ? (log.geo.allowed ? `OK (${log.geo.distanceMeters ?? '-'}m)` : 'Blocked') : 'Bypass'}</td>
    </tr>
  `).join('');
}

async function fetchReport() {
  const res = await fetch('/api/reports/weekly');
  const data = await res.json();
  const report = data.report || [];
  const body = document.getElementById('reportBody');

  if (!report.length) {
    body.innerHTML = '<tr><td colspan="7">No report yet</td></tr>';
    return;
  }

  body.innerHTML = report.map(row => `
    <tr>
      <td>${row.name}</td>
      <td>${row.site}</td>
      <td>£${Number(row.hourlyRate || 0).toFixed(2)}</td>
      <td>${Number(row.lunchMinutes || 0)} min</td>
      <td>${Number(row.totalHoursRaw || 0).toFixed(2)}</td>
      <td>${Number(row.paidHours || 0).toFixed(2)}</td>
      <td>£${Number(row.grossPay || 0).toFixed(2)}</td>
    </tr>
  `).join('');
}

async function addEmployee() {
  const name = document.getElementById('empName').value.trim();
  const pin = document.getElementById('empPin').value.trim();
  const siteValue = document.getElementById('empSite').value;
  const rate = document.getElementById('empRate').value;
  const lunch = document.getElementById('empLunch').value;
  const geoRequired = document.getElementById('empGeoRequired').checked;
  const isAdmin = document.getElementById('empIsAdmin').checked;
  const msg = document.getElementById('adminMessage');

  if (!name || !pin || !siteValue) {
    msg.style.color = '#ffb0a9';
    msg.textContent = 'Please fill required fields';
    return;
  }

  const [siteId, site] = siteValue.split('::');

  const res = await fetch('/api/employees', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      name,
      pin,
      site,
      siteId,
      hourlyRate: Number(rate || 0),
      lunchMinutes: Number(lunch || 0),
      geoRequired,
      isAdmin
    })
  });

  const data = await res.json();
  if (!res.ok) {
    msg.style.color = '#ffb0a9';
    msg.textContent = data.error || 'Failed';
    return;
  }

  msg.style.color = '#8ff0a4';
  msg.textContent = `${data.employee.name} created`;

  document.getElementById('empName').value = '';
  document.getElementById('empPin').value = '';
  document.getElementById('empRate').value = '';
  document.getElementById('empLunch').value = '';
  document.getElementById('empGeoRequired').checked = true;
  document.getElementById('empIsAdmin').checked = false;

  await fetchEmployees();
  await fetchReport();
}

document.getElementById('addEmployeeBtn').addEventListener('click', addEmployee);
document.getElementById('refreshLogsBtn').addEventListener('click', fetchLogs);
document.getElementById('refreshReportBtn').addEventListener('click', fetchReport);

async function init() {
  await fetchSites();
  await fetchEmployees();
  await fetchLogs();
  await fetchReport();
}

init();
