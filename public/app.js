
function clock(action) {
  const name = document.getElementById('name').value;

  fetch('/clock', {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({ name, action })
  })
  .then(() => alert('Saved'));
}
