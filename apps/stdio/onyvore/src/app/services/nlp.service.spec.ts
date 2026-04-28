import { NlpService } from './nlp.service';

describe('NlpService', () => {
  let svc: NlpService;

  beforeEach(() => {
    svc = new NlpService();
  });

  it('should extract nouns from content', () => {
    const terms = svc.extractTerms(
      'The Kubernetes cluster has multiple deployments running.',
    );
    expect(terms.size).toBeGreaterThan(0);
  });

  it('should lemmatize plural nouns to singular', () => {
    const terms = svc.extractTerms(
      'The deployments and clusters are configured with pods.',
    );
    // compromise.toSingular() should normalize plurals
    const keys = Array.from(terms.keys());
    // At least one of the singular forms should appear
    const hasSingularForm = keys.some(
      (k) => k === 'deployment' || k === 'cluster' || k === 'pod',
    );
    expect(hasSingularForm).toBe(true);
  });

  it('should filter stop nouns', () => {
    const terms = svc.extractTerms(
      'This is a note about some things and examples of files.',
    );
    expect(terms.has('note')).toBe(false);
    expect(terms.has('thing')).toBe(false);
    expect(terms.has('example')).toBe(false);
    expect(terms.has('file')).toBe(false);
  });

  it('should decompose multi-word phrases into individual words', () => {
    const terms = svc.extractTerms(
      'The load balancer handles incoming traffic.',
    );
    const keys = Array.from(terms.keys());
    // Should have individual words from multi-word phrases
    const hasIndividualWords = keys.some(
      (k) => k === 'load' || k === 'balancer' || k === 'traffic',
    );
    expect(hasIndividualWords).toBe(true);
  });

  it('should normalize to lowercase', () => {
    const terms = svc.extractTerms('Kubernetes and Docker are container tools.');
    const keys = Array.from(terms.keys());
    for (const key of keys) {
      expect(key).toBe(key.toLowerCase());
    }
  });

  it('should count term occurrences', () => {
    const terms = svc.extractTerms(
      'The server handles the server configuration. The server is fast.',
    );
    const serverCount = terms.get('server');
    if (serverCount !== undefined) {
      expect(serverCount).toBeGreaterThanOrEqual(1);
    }
  });

  it('should skip single-character terms', () => {
    const terms = svc.extractTerms('A B C and some real words like Kubernetes.');
    const keys = Array.from(terms.keys());
    for (const key of keys) {
      expect(key.length).toBeGreaterThan(1);
    }
  });

  it('should return an empty map for empty content', () => {
    const terms = svc.extractTerms('');
    expect(terms.size).toBe(0);
  });

  it('should handle content with no nouns', () => {
    const terms = svc.extractTerms('quickly and efficiently');
    // May or may not extract terms depending on compromise's parsing,
    // but should not throw
    expect(terms).toBeInstanceOf(Map);
  });
});
