const fs = require('fs');
let css = fs.readFileSync('src/index.css', 'utf-8');

// Replace blocks
css = css.replace(/\.miras-attachment-preview-body\s*\{[^}]*\}/g, (match) => {
    // We want to ensure it has flex and height 100%
    return `.miras-attachment-preview-body {
  display: flex !important;
  flex-direction: column !important;
  flex: 1 1 auto !important;
  width: 100% !important;
  height: 100% !important;
  min-height: 0 !important;
  max-height: none !important;
  overflow: hidden !important;
  background: #f8fafc !important;
  direction: ltr !important;
}`;
});

fs.writeFileSync('src/index.css', css);
