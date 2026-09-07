import { AppStdioOnyvoreConfig } from './app-stdio-onyvore-config.class';

describe('AppStdioOnyvoreConfig', () => {
  let config: AppStdioOnyvoreConfig;

  beforeEach(() => {
    config = new AppStdioOnyvoreConfig();
  });

  it('should apply provided settings', () => {
    config.update({
      similarityEnabled: false,
      similarityThreshold: 0.4,
      maxSimilarPerNote: 25,
    });

    expect(config.similarityEnabled).toBe(false);
    expect(config.similarityThreshold).toBe(0.4);
    expect(config.maxSimilarPerNote).toBe(25);
  });

  it('should report that the similarity graph is now stale', () => {
    expect(config.update({ similarityThreshold: 0.4 })).toBe(true);
  });

  it('should report no change when values are unchanged', () => {
    expect(
      config.update({
        similarityEnabled: config.similarityEnabled,
        similarityThreshold: config.similarityThreshold,
        maxSimilarPerNote: config.maxSimilarPerNote,
      }),
    ).toBe(false);
  });

  it('should ignore missing and non-numeric values', () => {
    const threshold = config.similarityThreshold;

    expect(config.update({})).toBe(false);
    expect(
      config.update({ similarityThreshold: undefined as unknown as number }),
    ).toBe(false);
    expect(
      config.update({ maxSimilarPerNote: 'ten' as unknown as number }),
    ).toBe(false);

    expect(config.similarityThreshold).toBe(threshold);
  });

  it('should keep the per-note cap a positive integer', () => {
    config.update({ maxSimilarPerNote: 7.9 });
    expect(config.maxSimilarPerNote).toBe(7);

    config.update({ maxSimilarPerNote: 0 });
    expect(config.maxSimilarPerNote).toBe(1);
  });

  it('should accept disabling similarity as a change', () => {
    expect(config.update({ similarityEnabled: false })).toBe(true);
    expect(config.update({ similarityEnabled: false })).toBe(false);
  });
});
