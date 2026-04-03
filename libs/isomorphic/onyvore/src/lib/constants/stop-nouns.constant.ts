export const STOP_NOUNS: ReadonlySet<string> = new Set([
  // Ultra-generic nouns
  'time', 'way', 'thing', 'part', 'people', 'day', 'year', 'example',
  'case', 'place', 'point', 'fact', 'hand', 'end', 'line', 'number',
  'group', 'area', 'world', 'work', 'state', 'system', 'program',
  'question', 'problem', 'issue', 'use', 'kind', 'sort', 'type',
  'form', 'set', 'list', 'level', 'side', 'head', 'home', 'office',
  'room', 'result', 'change', 'order', 'idea',
  // Domain-common (PKM noise)
  'note', 'file', 'page', 'document', 'section', 'item', 'entry',
  'record', 'version', 'name', 'title', 'link', 'tag', 'folder', 'draft',
]);
