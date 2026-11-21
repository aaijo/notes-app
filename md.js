// Markdown <-> checklist model.
// A checklist file is ordinary Markdown:
//   # Title
//
//   - [ ] open item
//   - [x] done item
// Every other line is kept untouched, so edits made on the Mac survive.

const TASK = /^(\s*)[-*+] \[( |x|X)\](?: (.*))?$/;
const TITLE = /^# (.*)$/;

export function parse(text) {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  if (lines.length && lines[lines.length - 1] === '') lines.pop();
  return lines.map((raw) => {
    let m;
    if ((m = raw.match(TASK))) return { kind: 'task', indent: m[1], done: m[2] !== ' ', text: m[3] ?? '' };
    if ((m = raw.match(TITLE))) return { kind: 'title', text: m[1] };
    return { kind: 'other', raw };
  });
}

export function serialize(lines) {
  return (
    lines
      .map((l) =>
        l.kind === 'task' ? `${l.indent}- [${l.done ? 'x' : ' '}] ${l.text}`
        : l.kind === 'title' ? `# ${l.text}`
        : l.raw
      )
      .join('\n') + '\n'
  );
}

export function titleOf(list) {
  const t = list.lines.find((l) => l.kind === 'title');
  return t ? t.text : list.name.replace(/\.md$/, '');
}

export function stats(lines) {
  const tasks = lines.filter((l) => l.kind === 'task');
  return { total: tasks.length, done: tasks.filter((l) => l.done).length };
}

// "Nákup na víkend!" -> "nakup-na-vikend"
export function slug(title) {
  return (
    title
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'checklist'
  );
}

// Insert a new task after the last existing task (or at the end).
export function addTask(lines, text) {
  const task = { kind: 'task', indent: '', done: false, text };
  let last = -1;
  lines.forEach((l, i) => { if (l.kind === 'task') last = i; });
  if (last === -1) lines.push(task);
  else lines.splice(last + 1, 0, task);
  return task;
}
