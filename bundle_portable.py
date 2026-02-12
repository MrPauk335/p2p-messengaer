import os
import re

def bundle():
    base_dir = r'd:\Projects\HTML\Messenger'
    index_path = os.path.join(base_dir, 'index.html')
    output_path = os.path.join(base_dir, 'messenger_portable.html')
    
    with open(index_path, 'r', encoding='utf-8') as f:
        html = f.read()

    # 1. Inline CSS
    css_match = re.search(r'<link rel="stylesheet" href="css/style\.css[^"]*">', html)
    if css_match:
        with open(os.path.join(base_dir, 'css', 'style.css'), 'r', encoding='utf-8') as f:
            css_content = f.read()
            # Wrap in style tag and remove the link tag
            html = html.replace(css_match.group(0), f'<style>\n{css_content}\n</style>')

    # 2. Inline JS
    js_files = ['app.js', 'utils.js', 'crypto.js', 'auth.js', 'sync.js', 'ui.js']
    for js_file in js_files:
        pattern = fr'<script src="js/{re.escape(js_file)}[^"]*"></script>'
        script_match = re.search(pattern, html)
        if script_match:
            with open(os.path.join(base_dir, 'js', js_file), 'r', encoding='utf-8') as f:
                js_content = f.read()
                html = html.replace(script_match.group(0), f'<script>\n{js_content}\n</script>')

    # 3. Update Title to indicate Portable
    html = html.replace('<title>P2P Messenger | Приватное общение</title>', '<title>P2P Messenger | Portable</title>')
    
    with open(output_path, 'w', encoding='utf-8') as f:
        f.write(html)
    
    print(f"Bundled successfully to {output_path}")

if __name__ == '__main__':
    bundle()
