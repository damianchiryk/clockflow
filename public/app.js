async function loadUsers() {
  const res = await fetch('/api/users');
  const users = await res.json();
  const select = document.getElementById('userSelect');
  select.innerHTML = users
    .map(user => `<option value="${user.id}">${user.name}</option>`)
    .join('');
}

async function submitClock(action) {
  const userId = document.getElementById('userSelect').value;
  const pin = document.getElementById('pinInput').value;
  const message = document.getElementById('message');

  message.textContent = 'Please wait...';

  const res = await fetch('/api/clock', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ userId, pin, action })
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
}

document.getElementById('clockInBtn').addEventListener('click', () => submitClock('in'));
document.getElementById('clockOutBtn').addEventListener('click', () => submitClock('out'));

loadUsers();
