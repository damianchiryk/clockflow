function clock(action){
  const name = document.getElementById('user').value;
  const pin = document.getElementById('pin').value;

  fetch('/clock',{
    method:'POST',
    headers:{'Content-Type':'application/json'},
    body: JSON.stringify({name, action, pin})
  })
  .then(()=> {
    document.getElementById('msg').innerText = "Saved";
  });
}
