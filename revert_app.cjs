const fs = require('fs');
let code = fs.readFileSync('src/App.tsx', 'utf-8');

// The replacement added to the top:
code = code.replace(
    /\{\s*previewAttachment\s*&&\s*\(\(\)\s*=>\s*\{[\s\S]*?return\s*\(\s*<div\s*className="miras-attachment-preview-overlay fixed inset-0 z-\[130\] flex items-center justify-center bg-slate-950\/70 p-3 backdrop-blur-sm"/,
    `      {previewAttachment && (
        <div
          className="miras-attachment-preview-overlay fixed inset-0 z-[130] flex items-center justify-center bg-slate-950/70 p-3 backdrop-blur-sm"`
);

// The replacement for the inner IIFE
code = code.replace(
    /\{\(\(\) => \{\s*const loadKey = attachmentLoadKey\(att\);/g,
    `{(() => {
                const att = previewAttachment;
                const loadKey = attachmentLoadKey(att);`
);

// The closing braces... wait, the closing braces are:
// `})()` at 21975 instead of `)}`. Wait, I didn't change the closing braces!
// So if I just revert the top, the syntax error will be fixed!

fs.writeFileSync('src/App.tsx', code);
