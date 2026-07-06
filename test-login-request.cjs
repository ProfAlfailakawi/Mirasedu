const http = require('http');

const data = JSON.stringify({
  idNumber: 'ada.alenezi@paaet.edu.kw',
  password: 'A97852900'
});

const req = http.request({
  hostname: 'localhost',
  port: 3000,
  path: '/api/auth/login',
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Content-Length': data.length
  }
}, (res) => {
  console.log('Status Code:', res.statusCode);
  let body = '';
  res.on('data', chunk => body += chunk);
  res.on('end', () => {
    console.log('Response Body:', body);
    process.exit(0);
  });
});

req.on('error', (e) => {
  console.error('Request Error:', e);
  process.exit(1);
});

req.write(data);
req.end();
