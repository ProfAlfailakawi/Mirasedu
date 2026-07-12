const http = require('http');
http.get('http://localhost:3000/api/teacher/sections?includeAll=1', (res) => {
  let data = '';
  res.on('data', chunk => data += chunk);
  res.on('end', () => console.log('Sections Response:', data));
});
http.get('http://localhost:3000/api/auth/lookup-student/random999', (res) => {
  // Just hitting an endpoint to see if students exist. Actually let's fetch students count if we have an endpoint.
});
