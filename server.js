const express = require('express');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 4000;

// Simple test route
app.get('/health', (req, res) => {
  res.send('OK');
});

// Example admin route
app.get('/admin', (req, res) => {
  res.send('Admin page working');
});

// Example mobile route
app.get('/mobile', (req, res) => {
  res.send('Mobile page working');
});

app.listen(PORT, '0.0.0.0', () => {
  console.log('Server running on port ' + PORT);
});
