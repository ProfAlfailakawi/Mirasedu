import re
with open('src/index.css', 'r') as f:
    css = f.read()

# Replace padding-top
css = re.sub(
    r'padding-top:\s*calc\([0-9\.]+rem \+ env\(safe-area-inset-top\)\)\s*!important;',
    r'padding-top: calc(0.35rem + env(safe-area-inset-top)) !important;',
    css
)

# Also fix the huge padding-bottoms which were 4.8rem, 5.5rem etc.
# We will reduce them to roughly 4rem so there is enough space for the dock but not too much.
css = re.sub(
    r'padding-bottom:\s*calc\([0-9\.]+rem \+ env\(safe-area-inset-bottom\)\)\s*!important;',
    r'padding-bottom: calc(4.1rem + env(safe-area-inset-bottom)) !important;',
    css
)

with open('src/index.css', 'w') as f:
    f.write(css)

print("Fixed CSS!")
