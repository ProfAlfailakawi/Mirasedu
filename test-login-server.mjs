async function test() {
  const res = await fetch('http://localhost:3000/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      idNumber: 'ada.alenezi@paaet.edu.kw',
      password: 'A97852900'
    })
  });
  console.log(res.status, await res.text());
}
test();
