import {
  parseSearchQuery,
  isEmptyQuery,
  isFilterOnlyQuery,
  describeQuery,
} from './parse-search-query';

describe('parseSearchQuery', () => {
  it('should collect bare words as terms', () => {
    const q = parseSearchQuery('sourdough starter');
    expect(q.terms).toEqual(['sourdough', 'starter']);
  });

  it('should lowercase terms', () => {
    expect(parseSearchQuery('SourDough').terms).toEqual(['sourdough']);
  });

  it('should collect quoted phrases', () => {
    const q = parseSearchQuery('bread "cold proof" rising');
    expect(q.phrases).toEqual(['cold proof']);
    expect(q.terms).toEqual(['bread', 'rising']);
  });

  it('should keep phrase casing for display but match case-insensitively later', () => {
    expect(parseSearchQuery('"Cold Proof"').phrases).toEqual(['Cold Proof']);
  });

  it('should collect exclusions', () => {
    const q = parseSearchQuery('bread -banana -sweet');
    expect(q.exclude).toEqual(['banana', 'sweet']);
    expect(q.terms).toEqual(['bread']);
  });

  it('should treat a lone dash as a term', () => {
    expect(parseSearchQuery('-').terms).toEqual(['-']);
  });

  it('should parse field operators', () => {
    const q = parseSearchQuery('title:recipe path:work');
    expect(q.title).toEqual(['recipe']);
    expect(q.path).toEqual(['work']);
    expect(q.terms).toEqual([]);
  });

  it('should parse in: and normalize the folder', () => {
    expect(parseSearchQuery('in:work/').inFolder).toBe('work');
    expect(parseSearchQuery('in:work').inFolder).toBe('work');
    expect(parseSearchQuery('in:a\\b\\').inFolder).toBe('a/b');
  });

  it('should parse graph operators', () => {
    const q = parseSearchQuery('links:hotsauce related:bread is:orphan');
    expect(q.links).toBe('hotsauce');
    expect(q.related).toBe('bread');
    expect(q.isOrphan).toBe(true);
  });

  it('should keep the note reference case for wikilink resolution', () => {
    expect(parseSearchQuery('links:HotSauce').links).toBe('HotSauce');
  });

  it('should treat an unknown operator as literal text', () => {
    const q = parseSearchQuery('foo:bar');
    expect(q.terms).toEqual(['foo:bar']);
    expect(q.title).toEqual([]);
  });

  it('should treat an operator with no value as literal text', () => {
    expect(parseSearchQuery('title:').terms).toEqual(['title:']);
  });

  it('should treat an unknown is: value as literal text', () => {
    const q = parseSearchQuery('is:draft');
    expect(q.isOrphan).toBe(false);
    expect(q.terms).toEqual(['is:draft']);
  });

  it('should ignore a leading colon', () => {
    expect(parseSearchQuery(':foo').terms).toEqual([':foo']);
  });

  it('should scope a quoted phrase to a field', () => {
    const q = parseSearchQuery('title:"cold proof"');
    expect(q.title).toEqual(['cold proof']);
    expect(q.phrases).toEqual([]);
  });

  it('should tolerate an unterminated quote', () => {
    expect(parseSearchQuery('"cold proof').phrases).toEqual(['cold proof']);
  });

  it('should combine everything', () => {
    const q = parseSearchQuery('bread "cold proof" -banana title:recipe in:work/ is:orphan');
    expect(q.terms).toEqual(['bread']);
    expect(q.phrases).toEqual(['cold proof']);
    expect(q.exclude).toEqual(['banana']);
    expect(q.title).toEqual(['recipe']);
    expect(q.inFolder).toBe('work');
    expect(q.isOrphan).toBe(true);
  });

  it('should preserve the raw query', () => {
    expect(parseSearchQuery('  bread  ').raw).toBe('  bread  ');
  });

  it('should collapse extra whitespace', () => {
    expect(parseSearchQuery('  bread   rising  ').terms).toEqual(['bread', 'rising']);
  });
});

describe('isEmptyQuery', () => {
  it('should be true for blank input', () => {
    expect(isEmptyQuery(parseSearchQuery(''))).toBe(true);
    expect(isEmptyQuery(parseSearchQuery('   '))).toBe(true);
  });

  it('should be false for any term or filter', () => {
    expect(isEmptyQuery(parseSearchQuery('bread'))).toBe(false);
    expect(isEmptyQuery(parseSearchQuery('is:orphan'))).toBe(false);
    expect(isEmptyQuery(parseSearchQuery('-banana'))).toBe(false);
  });
});

describe('isFilterOnlyQuery', () => {
  it('should be true when nothing can be ranked', () => {
    expect(isFilterOnlyQuery(parseSearchQuery('is:orphan'))).toBe(true);
    expect(isFilterOnlyQuery(parseSearchQuery('links:hotsauce'))).toBe(true);
    expect(isFilterOnlyQuery(parseSearchQuery('in:work/'))).toBe(true);
  });

  it('should be false once there is something to search for', () => {
    expect(isFilterOnlyQuery(parseSearchQuery('is:orphan bread'))).toBe(false);
    expect(isFilterOnlyQuery(parseSearchQuery('title:x'))).toBe(false);
    expect(isFilterOnlyQuery(parseSearchQuery('"a phrase"'))).toBe(false);
  });

  it('should be false for an empty query', () => {
    expect(isFilterOnlyQuery(parseSearchQuery(''))).toBe(false);
  });
});

describe('describeQuery', () => {
  it('should read back a plain query', () => {
    expect(describeQuery(parseSearchQuery('bread rising'))).toBe('bread + rising');
  });

  it('should read back operators in plain language', () => {
    expect(describeQuery(parseSearchQuery('in:work/ is:orphan'))).toBe(
      'in work/, unlinked',
    );
  });

  it('should describe exclusions last', () => {
    expect(describeQuery(parseSearchQuery('bread -banana'))).toBe('bread, not banana');
  });

  it('should be empty for an empty query', () => {
    expect(describeQuery(parseSearchQuery(''))).toBe('');
  });
});
