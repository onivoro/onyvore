import {
  parseWikilinks,
  resolveWikilinkTarget,
  wikilinkCompletionFor,
  noteBasename,
} from './wikilink-parser';

/** Drop offsets when a test only cares about what was parsed. */
function values(content: string) {
  return parseWikilinks(content).map(({ target, displayText }) => ({
    target,
    displayText,
  }));
}

describe('parseWikilinks', () => {
  it('should parse simple wikilinks', () => {
    expect(values('See [[My Note]] for details.')).toEqual([
      { target: 'My Note', displayText: null },
    ]);
  });

  it('should parse wikilinks with display text', () => {
    expect(values('See [[My Note|custom label]] for details.')).toEqual([
      { target: 'My Note', displayText: 'custom label' },
    ]);
  });

  it('should parse multiple wikilinks', () => {
    expect(values('Links to [[A]], [[B|beta]], and [[C]].')).toEqual([
      { target: 'A', displayText: null },
      { target: 'B', displayText: 'beta' },
      { target: 'C', displayText: null },
    ]);
  });

  it('should skip wikilinks inside fenced code blocks', () => {
    const content = [
      'Some text [[valid]].',
      '',
      '```',
      '[[inside code block]]',
      '```',
      '',
      'More text [[also valid]].',
    ].join('\n');

    expect(values(content)).toEqual([
      { target: 'valid', displayText: null },
      { target: 'also valid', displayText: null },
    ]);
  });

  it('should skip wikilinks inside inline code', () => {
    expect(values('Use `[[not a link]]` but [[this one]] counts.')).toEqual([
      { target: 'this one', displayText: null },
    ]);
  });

  it('should trim whitespace from target and display text', () => {
    expect(values('[[  spaced  |  label  ]]')).toEqual([
      { target: 'spaced', displayText: 'label' },
    ]);
  });

  it('should skip empty wikilinks', () => {
    expect(values('[[]] and [[   ]] and [[real]]')).toEqual([
      { target: 'real', displayText: null },
    ]);
  });

  it('should keep a .md extension in the target for the resolver to handle', () => {
    expect(values('[[note.md]]')).toEqual([
      { target: 'note.md', displayText: null },
    ]);
  });

  it('should handle wikilinks with path separators', () => {
    expect(values('[[work/overview]]')).toEqual([
      { target: 'work/overview', displayText: null },
    ]);
  });

  it('should treat an empty display half as no display text', () => {
    expect(values('[[target|]]')).toEqual([
      { target: 'target', displayText: null },
    ]);
  });

  describe('offsets', () => {
    it('should report the span of each link in the source', () => {
      const content = 'a [[one]] b [[two]]';
      const [first, second] = parseWikilinks(content);

      expect(content.slice(first.start, first.end)).toBe('[[one]]');
      expect(content.slice(second.start, second.end)).toBe('[[two]]');
    });

    it('should keep offsets valid after code is skipped', () => {
      // Code is blanked, not removed, so later links keep their real positions.
      const content = 'start `[[code]]` middle [[real]] end';
      const [link] = parseWikilinks(content);

      expect(link.target).toBe('real');
      expect(content.slice(link.start, link.end)).toBe('[[real]]');
    });

    it('should keep offsets valid after a fenced block', () => {
      const content = ['```', '[[skipped]]', '```', '[[kept]]'].join('\n');
      const [link] = parseWikilinks(content);

      expect(link.target).toBe('kept');
      expect(content.slice(link.start, link.end)).toBe('[[kept]]');
    });
  });
});

describe('resolveWikilinkTarget', () => {
  const files = [
    'overview.md',
    'work/overview.md',
    'work/projects.md',
    'personal/journal.md',
  ];

  it('should resolve a basename match', () => {
    expect(resolveWikilinkTarget('projects', files)).toBe('work/projects.md');
  });

  it('should resolve a basename match case-insensitively', () => {
    expect(resolveWikilinkTarget('PROJECTS', files)).toBe('work/projects.md');
  });

  it('should resolve a path-based match', () => {
    expect(resolveWikilinkTarget('work/overview', files)).toBe('work/overview.md');
  });

  it('should resolve a path-based match case-insensitively', () => {
    expect(resolveWikilinkTarget('Work/Overview', files)).toBe('work/overview.md');
  });

  it('should prefer the shortest path when several basenames match', () => {
    expect(resolveWikilinkTarget('overview', files)).toBe('overview.md');
  });

  it('should strip a .md extension before matching', () => {
    expect(resolveWikilinkTarget('journal.md', files)).toBe('personal/journal.md');
  });

  it('should return null for an unresolved target', () => {
    expect(resolveWikilinkTarget('nonexistent', files)).toBeNull();
  });

  it('should return null for an empty target', () => {
    expect(resolveWikilinkTarget('', files)).toBeNull();
    expect(resolveWikilinkTarget('.md', files)).toBeNull();
  });

  it('should match Windows-style stored paths', () => {
    expect(resolveWikilinkTarget('work/overview', ['work\\overview.md'])).toBe(
      'work\\overview.md',
    );
  });
});

describe('noteBasename', () => {
  it('should drop the directory and extension', () => {
    expect(noteBasename('work/deep/notes.md')).toBe('notes');
  });

  it('should handle root-level files', () => {
    expect(noteBasename('notes.md')).toBe('notes');
  });

  it('should handle Windows separators', () => {
    expect(noteBasename('work\\notes.md')).toBe('notes');
  });
});

describe('wikilinkCompletionFor', () => {
  it('should suggest the bare basename when unambiguous', () => {
    const files = ['work/projects.md', 'personal/journal.md'];
    expect(wikilinkCompletionFor('work/projects.md', files)).toBe('projects');
  });

  it('should suggest the full path when the basename is ambiguous', () => {
    const files = ['work/overview.md', 'personal/overview.md'];
    expect(wikilinkCompletionFor('work/overview.md', files)).toBe('work/overview');
  });

  it('should round-trip through the resolver', () => {
    const files = ['overview.md', 'work/overview.md', 'work/projects.md'];

    for (const file of files) {
      const suggestion = wikilinkCompletionFor(file, files);
      expect(resolveWikilinkTarget(suggestion, files)).toBe(file);
    }
  });
});
