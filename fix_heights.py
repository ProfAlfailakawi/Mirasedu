import re

with open('src/index.css', 'r') as f:
    css = f.read()

# Replace height: auto with height: 100dvh for the teacher shell in media queries
css = re.sub(
    r'\.meras-teacher-shell\.teacher-calm-shell,\s*\.teacher-calm-shell\s*\{\s*min-height: 0 !important;\s*height: auto !important;',
    r'.meras-teacher-shell.teacher-calm-shell, .teacher-calm-shell { min-height: 100dvh !important; height: 100dvh !important;',
    css
)

# And for main/teacher-command-main
css = re.sub(
    r'\.teacher-calm-shell main,\s*\.meras-teacher-shell\.teacher-calm-shell \.teacher-command-main\s*\{\s*min-height: 0 !important;\s*height: auto !important;',
    r'.teacher-calm-shell main, .meras-teacher-shell.teacher-calm-shell .teacher-command-main { height: 100dvh !important; max-height: 100dvh !important; flex: 1 1 auto !important; overflow-y: auto !important;',
    css
)

with open('src/index.css', 'w') as f:
    f.write(css)

print("Fixed heights!")
