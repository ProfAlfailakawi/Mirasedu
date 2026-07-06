const fs = require('fs');
let css = fs.readFileSync('src/index.css', 'utf-8');

css = css.replace(/\.miras-document-simple-shell\s*\{/g, '.miras-document-simple-shell {\n  flex: 1 1 auto !important;');
css = css.replace(/\.miras-attachment-pdf-fit-shell\s*\{/g, '.miras-attachment-pdf-fit-shell {\n  flex: 1 1 auto !important;');

fs.writeFileSync('src/index.css', css);
