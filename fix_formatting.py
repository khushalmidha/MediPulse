import re

with open('C:/Users/khush/.gemini/antigravity-ide/brain/1a0b7b4a-73ec-43a5-9741-5b99f85c9278/scratch/master_doc_content.txt', 'r', encoding='utf-8') as f:
    lines = f.readlines()

# Extract just the first document
doc_lines = []
for line in lines:
    doc_lines.append(line)
    if 'Read this once, fully. It supersedes every earlier document' in line:
        break

out_lines = []
for i, line in enumerate(doc_lines):
    line = line.strip()
    if not line:
        out_lines.append('\n\n')
        continue

    # Detect headers
    if re.match(r'^(PART \d+|Era \d+|TABLE OF CONTENTS|Chapter |[0-9]+\.[0-9]+ )', line, re.IGNORECASE):
        out_lines.append(f'\n\n# {line}\n\n')
        continue

    # Detect bullet points or short items
    if line.startswith('- ') or line.startswith('* '):
        out_lines.append(f'\n{line} ')
        continue

    # If it's a normal line, decide whether to append a space or a newline
    if out_lines and not out_lines[-1].endswith('\n') and not out_lines[-1].endswith('\n\n'):
        # join with previous line
        out_lines[-1] = out_lines[-1] + ' ' + line
    else:
        out_lines.append(line)

final_text = ''.join(out_lines)

# Fix some spacing issues
final_text = re.sub(r' +', ' ', final_text)
final_text = final_text.replace('\n \n', '\n\n')
final_text = re.sub(r'\n{3,}', '\n\n', final_text)

with open('MEDIPULSE_ULTIMATE_INTERVIEW_BOOK.md', 'w', encoding='utf-8') as f:
    f.write('# MEDIPULSE: THE DEFINITIVE MASTER DOCUMENT\n\n')
    f.write(final_text)

