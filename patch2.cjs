const fs = require('fs');
let code = fs.readFileSync('App.tsx', 'utf8');

code = code.replace(/onPointerUp=\{\(e\) => \{\s*e\.preventDefault\(\);\s*e\.stopPropagation\(\);\s*void toggleTeacherImportantNotificationsPanel\(true\);\s*\}\}/g, '');
fs.writeFileSync('App.tsx', code);
console.log('patched pointer up');
