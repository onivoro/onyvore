import {
  tokenize,
  wordPrefixPattern,
  hasWordPrefix,
  hasAnyWordPrefix,
  hasPhrase,
  matchPositions,
} from './search-text';

describe('tokenize', () => {
  it('should split on non-word characters and lowercase', () => {
    expect(tokenize('Cold-proof, the DOUGH!')).toEqual(['cold', 'proof', 'the', 'dough']);
  });

  it('should handle accented letters as word characters', () => {
    expect(tokenize('café résumé')).toEqual(['café', 'résumé']);
  });
});

describe('hasWordPrefix', () => {
  it('should match a whole word', () => {
    expect(hasWordPrefix('the running notes', 'running')).toBe(true);
  });

  it('should match a prefix of a word', () => {
    expect(hasWordPrefix('the running notes', 'run')).toBe(true);
  });

  it('should not match inside a word', () => {
    // The bug this rule exists to prevent: "run" is inside "brunch".
    expect(hasWordPrefix('notes on brunch', 'run')).toBe(false);
  });

  it('should be case-insensitive', () => {
    expect(hasWordPrefix('Running notes', 'run')).toBe(true);
  });

  it('should match after punctuation', () => {
    expect(hasWordPrefix('notes (running)', 'run')).toBe(true);
  });

  it('should not match an empty term', () => {
    expect(hasWordPrefix('anything', '')).toBe(false);
  });
});

describe('hasAnyWordPrefix', () => {
  it('should be true when any term matches', () => {
    expect(hasAnyWordPrefix('the dough rises', ['flour', 'dough'])).toBe(true);
  });

  it('should be false when none match', () => {
    expect(hasAnyWordPrefix('the dough rises', ['flour', 'salt'])).toBe(false);
  });
});

describe('hasPhrase', () => {
  it('should match consecutive words', () => {
    expect(hasPhrase('a cold proof works', 'cold proof')).toBe(true);
  });

  it('should not match the words out of order', () => {
    expect(hasPhrase('a proof that is cold', 'cold proof')).toBe(false);
  });

  it('should not match the words separated', () => {
    expect(hasPhrase('cold and slow proof', 'cold proof')).toBe(false);
  });

  it('should tolerate punctuation between words', () => {
    expect(hasPhrase('cold, proof', 'cold proof')).toBe(true);
  });

  it('should require the last word whole, not by prefix', () => {
    // A quoted phrase is where the user asked for exactness.
    expect(hasPhrase('cold proofing', 'cold proof')).toBe(false);
  });

  it('should be case-insensitive', () => {
    expect(hasPhrase('A Cold Proof', 'cold proof')).toBe(true);
  });

  it('should handle a single-word phrase', () => {
    expect(hasPhrase('the dough', 'dough')).toBe(true);
    expect(hasPhrase('the doughnut', 'dough')).toBe(false);
  });
});

describe('wordPrefixPattern', () => {
  it('should return null when there is nothing to match', () => {
    expect(wordPrefixPattern([])).toBeNull();
    expect(wordPrefixPattern(['  '])).toBeNull();
  });

  it('should escape regex metacharacters', () => {
    const pattern = wordPrefixPattern(['c++']);
    expect(pattern?.test('c++ notes')).toBe(true);
  });

  it('should prefer the longest term when several could match', () => {
    const pattern = wordPrefixPattern(['sour', 'sourdough'])!;
    expect('sourdough bread'.match(pattern)?.[0]).toBe('sourdough');
  });
});

describe('matchPositions', () => {
  it('should report every word-start match', () => {
    const text = 'run running brunch rundown';
    expect(matchPositions(text, ['run'])).toEqual([0, 4, 19]);
  });

  it('should return nothing when there are no matches', () => {
    expect(matchPositions('nothing here', ['absent'])).toEqual([]);
  });

  it('should return nothing for no terms', () => {
    expect(matchPositions('anything', [])).toEqual([]);
  });
});
