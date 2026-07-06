const fs = require('fs');
let css = fs.readFileSync('src/index.css', 'utf-8');

// Replace height and max-height from .miras-attachment-preview-panel
css = css.replace(/\.miras-attachment-preview-panel\s*\{[^}]*\}/g, (match) => {
    let replaced = match;
    replaced = replaced.replace(/\s*height:[^;]+;/g, '');
    replaced = replaced.replace(/\s*max-height:[^;]+;/g, '');
    return replaced;
});

fs.writeFileSync('src/index.css', css);
