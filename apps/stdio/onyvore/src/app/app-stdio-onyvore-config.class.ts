export class AppStdioOnyvoreConfig {
  /** Files processed between persistence checkpoints during a full build. */
  readonly checkpointInterval = 100;

  /** Minimum cosine similarity for a `similar` edge. */
  readonly similarityThreshold = 0.15;

  /**
   * Cap on `similar` edges kept per note. Without it the graph is O(n²) in the
   * worst case, which makes links.json larger than the notebook it describes
   * and the Related Notes list unreadable.
   */
  readonly maxSimilarPerNote = 10;
}
