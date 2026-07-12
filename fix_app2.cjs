const fs = require('fs');
let code = fs.readFileSync('src/App.tsx', 'utf-8');

code = code.replace(
    /className=\{\`miras-attachment-preview-panel relative flex w-full max-w-3xl flex-col overflow-hidden rounded-\[1\.6rem\] border border-white\/15 bg-white shadow-\[0_28px_90px_rgba\(15,23,42,0\.5\)\] \$\{isImage \? "h-auto max-h-\[92vh\]" : "h-\[92vh\]"\}\`\}/,
    `className={\`miras-attachment-preview-panel relative flex w-full max-w-3xl flex-col overflow-hidden rounded-[1.6rem] border border-white/15 bg-white shadow-[0_28px_90px_rgba(15,23,42,0.5)] \${([".jpg", ".jpeg", ".png", ".webp", ".gif", ".heic", ".heif"].includes(String(previewAttachment.originalName || "").slice(String(previewAttachment.originalName || "").lastIndexOf(".")).toLowerCase()) || String(previewAttachment.mimeType || "").startsWith("image/")) ? "h-auto max-h-[92vh]" : "h-[92vh]"}\`}`
);

fs.writeFileSync('src/App.tsx', code);
