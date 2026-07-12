const fs = require('fs');
let code = fs.readFileSync('App.tsx', 'utf8');

const target = `createPortal(
                              <div
                                className="student-popover teacher-important-popover miras-teacher-alert-popover miras-student-popover miras-student-alert-popover text-right"
                                dir="rtl"
                                style={{`;

const replacement = `createPortal(
                              <div className="meras-teacher-shell teacher-calm-shell" dir="rtl">
                              <div
                                className="student-popover teacher-important-popover miras-teacher-alert-popover miras-student-popover miras-student-alert-popover text-right"
                                dir="rtl"
                                style={{`;

if (code.includes(target)) {
  code = code.replace(target, replacement);
  
  const endTarget = `                              </div>,
                                document.body,
                              )}`;
  const endReplacement = `                              </div>
                              </div>,
                                document.body,
                              )}`;
                              
  code = code.replace(endTarget, endReplacement);
  fs.writeFileSync('App.tsx', code);
  console.log('patched');
} else {
  console.log('target not found');
}
