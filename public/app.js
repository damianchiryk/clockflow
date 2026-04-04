async function loadUsers() {
  const res = await fetch('/api/users');
  const users = await res.json();
  const select = document.getElementById('userSelect');
  select.innerHTML = users.map(u => `<option value="${u.id}">${u.name}</option>`).join('');
}

async function sendClock(action) {
  const userId = document.getElementById('userSelect').value;
  const pin = document.getElementById('pinInput').value;
  const message = document.getElementById('message');

  message.textContent = 'Please wait...';

  const res = await fetch('/api/clock', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userId, pin, action })
  });

  const data = await res.json();

  if (!res.ok) {
    message.textContent = data.error || 'Something went wrong';
    message.style.color = '#fca5a5';
    return;
  }

  message.textContent = `${data.message} at ${data.entry.localTime}`;
  message.style.color = '#86efac';
  document.getElementById('pinInput').value = '';
}

document.getElementById('clockInBtn').addEventListener('click', () => sendClock('in'));
document.getElementById('clockOutBtn').addEventListener('click', () => sendClock('out'));

loadUsers();
