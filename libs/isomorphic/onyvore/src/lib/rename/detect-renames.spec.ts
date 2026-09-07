import { detectRenames } from './detect-renames';

describe('detectRenames', () => {
  it('should pair a deletion and creation with identical content', () => {
    expect(
      detectRenames(
        [{ relativePath: 'old.md', hash: 'abc' }],
        [{ relativePath: 'new.md', hash: 'abc' }],
      ),
    ).toEqual([{ from: 'old.md', to: 'new.md' }]);
  });

  it('should not pair different content', () => {
    expect(
      detectRenames(
        [{ relativePath: 'old.md', hash: 'abc' }],
        [{ relativePath: 'new.md', hash: 'def' }],
      ),
    ).toEqual([]);
  });

  it('should pair several independent renames in one batch', () => {
    const pairs = detectRenames(
      [
        { relativePath: 'a-old.md', hash: 'aaa' },
        { relativePath: 'b-old.md', hash: 'bbb' },
      ],
      [
        { relativePath: 'b-new.md', hash: 'bbb' },
        { relativePath: 'a-new.md', hash: 'aaa' },
      ],
    );

    expect(pairs).toHaveLength(2);
    expect(pairs).toContainEqual({ from: 'a-old.md', to: 'a-new.md' });
    expect(pairs).toContainEqual({ from: 'b-old.md', to: 'b-new.md' });
  });

  it('should refuse to guess when two deletions share a hash', () => {
    // Two empty notes deleted, one created: which one moved is unknowable.
    expect(
      detectRenames(
        [
          { relativePath: 'empty-a.md', hash: 'e3b0c4' },
          { relativePath: 'empty-b.md', hash: 'e3b0c4' },
        ],
        [{ relativePath: 'empty-c.md', hash: 'e3b0c4' }],
      ),
    ).toEqual([]);
  });

  it('should refuse to guess when two creations share a hash', () => {
    expect(
      detectRenames(
        [{ relativePath: 'template.md', hash: 'tpl' }],
        [
          { relativePath: 'copy-1.md', hash: 'tpl' },
          { relativePath: 'copy-2.md', hash: 'tpl' },
        ],
      ),
    ).toEqual([]);
  });

  it('should ignore entries with no hash', () => {
    expect(
      detectRenames(
        [{ relativePath: 'old.md' }],
        [{ relativePath: 'new.md' }],
      ),
    ).toEqual([]);

    expect(
      detectRenames(
        [{ relativePath: 'old.md' }],
        [{ relativePath: 'new.md', hash: 'abc' }],
      ),
    ).toEqual([]);
  });

  it('should handle empty inputs', () => {
    expect(detectRenames([], [])).toEqual([]);
    expect(detectRenames([{ relativePath: 'a.md', hash: 'x' }], [])).toEqual([]);
    expect(detectRenames([], [{ relativePath: 'a.md', hash: 'x' }])).toEqual([]);
  });

  it('should pair only the unambiguous hash when a batch mixes both', () => {
    const pairs = detectRenames(
      [
        { relativePath: 'moved-old.md', hash: 'unique' },
        { relativePath: 'blank-a.md', hash: 'blank' },
        { relativePath: 'blank-b.md', hash: 'blank' },
      ],
      [
        { relativePath: 'moved-new.md', hash: 'unique' },
        { relativePath: 'blank-c.md', hash: 'blank' },
      ],
    );

    expect(pairs).toEqual([{ from: 'moved-old.md', to: 'moved-new.md' }]);
  });
});
