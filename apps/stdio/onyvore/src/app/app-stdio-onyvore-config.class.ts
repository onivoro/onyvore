export interface OnyvoreServerSettings {
  similarityEnabled: boolean;
  similarityThreshold: number;
  maxSimilarPerNote: number;
}

export class AppStdioOnyvoreConfig implements OnyvoreServerSettings {
  /** Files processed between persistence checkpoints during a full build. */
  readonly checkpointInterval = 100;

  /** Whether to compute `similar` edges at all. */
  similarityEnabled = true;

  /** Minimum cosine similarity for a `similar` edge. */
  similarityThreshold = 0.15;

  /**
   * Cap on `similar` edges kept per note. Without it the graph is O(n²) in the
   * worst case, which makes links.json larger than the notebook it describes
   * and the Related Notes list unreadable.
   */
  maxSimilarPerNote = 10;

  /**
   * Apply user settings from the extension host. Returns true when a value
   * that affects the similarity graph changed, so the caller knows the existing
   * edges are now stale and must be recomputed.
   */
  update(settings: Partial<OnyvoreServerSettings>): boolean {
    const before = [
      this.similarityEnabled,
      this.similarityThreshold,
      this.maxSimilarPerNote,
    ];

    if (typeof settings.similarityEnabled === 'boolean') {
      this.similarityEnabled = settings.similarityEnabled;
    }
    if (Number.isFinite(settings.similarityThreshold)) {
      this.similarityThreshold = settings.similarityThreshold as number;
    }
    if (Number.isFinite(settings.maxSimilarPerNote)) {
      this.maxSimilarPerNote = Math.max(1, Math.floor(settings.maxSimilarPerNote as number));
    }

    return (
      before[0] !== this.similarityEnabled ||
      before[1] !== this.similarityThreshold ||
      before[2] !== this.maxSimilarPerNote
    );
  }
}
