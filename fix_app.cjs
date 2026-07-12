const fs = require('fs');
let code = fs.readFileSync('src/App.tsx', 'utf-8');

const replacement = `      {previewAttachment && (() => {
        const att = previewAttachment;
        const name = String(att.originalName || "");
        const ext = name.slice(name.lastIndexOf(".")).toLowerCase();
        const isImage =
          [".jpg", ".jpeg", ".png", ".webp", ".gif", ".heic", ".heif"].includes(ext) ||
          String(att.mimeType || "").startsWith("image/");
        return (
        <div
          className="miras-attachment-preview-overlay fixed inset-0 z-[130] flex items-center justify-center bg-slate-950/70 p-3 backdrop-blur-sm"
          dir="rtl"
          onClick={() => setPreviewAttachment(null)}
        >
          <div
            className={\`miras-attachment-preview-panel relative flex w-full max-w-3xl flex-col overflow-hidden rounded-[1.6rem] border border-white/15 bg-white shadow-[0_28px_90px_rgba(15,23,42,0.5)] \${isImage ? "h-auto max-h-[92vh]" : "h-[92vh]"}\`}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="miras-attachment-preview-header flex items-center justify-between gap-2 border-b border-slate-100 px-4 py-3">`;

code = code.replace(
    /\{\s*previewAttachment\s*&&\s*\(\s*<div\s*className="miras-attachment-preview-overlay fixed inset-0 z-\[130\] flex items-center justify-center bg-slate-950\/70 p-3 backdrop-blur-sm"[\s\S]*?onClick=\{\(e\) => e.stopPropagation\(\)\}\s*>\s*<div className="miras-attachment-preview-header flex items-center justify-between gap-2 border-b border-slate-100 px-4 py-3">/,
    replacement
);

code = code.replace(
    /\{\(\(\) => \{\s*const att = previewAttachment;\s*const loadKey = attachmentLoadKey\(att\);/g,
    `{(() => {
                const loadKey = attachmentLoadKey(att);`
);

code = code.replace(
    /\{\s*previewAttachment\s*&&\s*\(\s*<div\s*className="miras-attachment-preview-overlay/g, 
    "THIS WASNT REPLACED"
)

fs.writeFileSync('src/App.tsx', code);
