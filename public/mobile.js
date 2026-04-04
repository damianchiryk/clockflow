let employeeMap = {};

async function loadEmployees() {
  const res = await fetch('/api/employees');
  const employees = await res.json();
  const select = document.getElementById('employeeSelect');

  employeeMap = {};
  employees.forEach(e => employeeMap[e.id] = e);

  select.innerHTML = employees.map(e => `<option value="${e.id}">${e.name}</option>`).join('');
  updateSiteNote();
}

function updateSiteNote() {
  const id = document.getElementById('employeeSelect').value;
  const employee = employeeMap[id];
  const note = document.getElementById('siteNote');
  if (!employee) {
    note.textContent = '';
    return;
  }

  note.textContent = employee.geoRequired
    ? `Clocking allowed only near: ${employee.site} (200m radius)`
    : `Geolocation bypass enabled for ${employee.name}`;
}

function getCurrentPositionAsync() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error('Geolocation is not supported'));
      return;
    }

    navigator.geolocation.getCurrentPosition(
      pos => resolve(pos),
      err => reject(err),
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
    );
  });
}

async function submitClock(action) {
  const employeeId = document.getElementById('employeeSelect').value;
  const pin = document.getElementById('pinInput').value.trim();
  const message = document.getElementById('message');
  const employee = employeeMap[employeeId];

  message.style.color = '#9cc2ff';
  message.textContent = 'Please wait...';

  let payload = { employeeId, pin, action };

  try {
    if (employee && employee.geoRequired) {
      const pos = await getCurrentPositionAsync();
      payload.lat = pos.coords.latitude;
      payload.lng = pos.coords.longitude;
    }

    const res = await fetch('/api/clock', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    const data = await res.json();

    if (!res.ok) {
      message.style.color = '#ffb0a9';
      message.textContent = data.error || 'Something went wrong';
      return;
    }

    message.style.color = '#8ff0a4';
    message.textContent = `${data.message} at ${data.entry.localTime}`;
    document.getElementById('pinInput').value = '';
  } catch (err) {
    message.style.color = '#ffb0a9';
    message.textContent = err.message || 'Location request failed';
  }
}

document.getElementById('employeeSelect').addEventListener('change', updateSiteNote);
document.getElementById('clockInBtn').addEventListener('click', () => submitClock('in'));
document.getElementById('clockOutBtn').addEventListener('click', () => submitClock('out'));

loadEmployees();
