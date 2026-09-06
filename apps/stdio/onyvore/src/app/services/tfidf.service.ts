import { Injectable } from '@nestjs/common';
import type { Edge } from '@onivoro/isomorphic-onyvore';
import { AppStdioOnyvoreConfig } from '../app-stdio-onyvore-config.class';
import { TermStoreService, type NotebookTerms } from './term-store.service';

export interface TfidfPersisted {
  tf: Record<string, Record<string, number>>;
  df: Record<string, number>;
}

interface TfidfCorpus {
  /** Per-document term frequency vectors, owned by TermStoreService. */
  tf: NotebookTerms;
  /** Document frequency: term -> number of documents containing the term */
  df: Map<string, number>;
  /** Total number of documents in corpus */
  docCount: number;
  /**
   * Bumped on every change to `df` or `docCount`. TF-IDF vectors depend on
   * corpus-wide document frequency, so a single edit invalidates every cached
   * vector — this is what tells the cache that.
   */
  version: number;
  /** Vectors cached at `cacheVersion`; discarded when the corpus moves on. */
  cache: Map<string, CachedVector>;
  cacheVersion: number;
}

interface CachedVector {
  vec: Map<string, number>;
  mag: number;
}

@Injectable()
export class TfidfService {
  private corpora = new Map<string, TfidfCorpus>();

  constructor(
    private readonly config: AppStdioOnyvoreConfig,
    private readonly termStore: TermStoreService,
  ) {}

  getOrCreateCorpus(notebookId: string): TfidfCorpus {
    let corpus = this.corpora.get(notebookId);
    if (!corpus) {
      corpus = {
        tf: this.termStore.getOrCreate(notebookId),
        df: new Map(),
        docCount: 0,
        version: 0,
        cache: new Map(),
        cacheVersion: -1,
      };
      this.corpora.set(notebookId, corpus);
    }
    return corpus;
  }

  removeCorpus(notebookId: string): void {
    this.corpora.delete(notebookId);
    this.termStore.remove(notebookId);
  }

  /**
   * Register or update a document's term frequencies.
   * Incrementally updates the DF map: decrements DF for old terms (if doc existed),
   * increments DF for new terms.
   */
  setDocument(
    notebookId: string,
    filePath: string,
    terms: Map<string, number>,
  ): void {
    const corpus = this.getOrCreateCorpus(notebookId);
    const oldTerms = corpus.tf.get(filePath);

    if (oldTerms) {
      // Decrement DF for terms in the old version
      for (const term of oldTerms.keys()) {
        const count = corpus.df.get(term);
        if (count !== undefined) {
          if (count <= 1) {
            corpus.df.delete(term);
          } else {
            corpus.df.set(term, count - 1);
          }
        }
      }
    } else {
      corpus.docCount++;
    }

    // Store new term frequencies
    corpus.tf.set(filePath, terms);

    // Increment DF for terms in the new version
    for (const term of terms.keys()) {
      corpus.df.set(term, (corpus.df.get(term) ?? 0) + 1);
    }

    corpus.version++;
  }

  /**
   * Remove a document from the corpus. Decrements DF for all its terms.
   */
  removeDocument(notebookId: string, filePath: string): void {
    const corpus = this.corpora.get(notebookId);
    if (!corpus) return;

    const oldTerms = corpus.tf.get(filePath);
    if (!oldTerms) return;

    for (const term of oldTerms.keys()) {
      const count = corpus.df.get(term);
      if (count !== undefined) {
        if (count <= 1) {
          corpus.df.delete(term);
        } else {
          corpus.df.set(term, count - 1);
        }
      }
    }

    corpus.tf.delete(filePath);
    corpus.docCount--;
    corpus.version++;
  }

  /**
   * Compute all edges for a single document against the rest of the corpus.
   * Returns edges in BOTH directions (A->B and B->A) for each surviving pair.
   */
  computeEdgesForDocument(notebookId: string, filePath: string): Edge[] {
    if (!this.config.similarityEnabled) return [];
    const corpus = this.corpora.get(notebookId);
    if (!corpus || corpus.docCount < 2) return [];

    const vectors = this.vectors(corpus);
    const a = vectors.get(filePath);
    if (!a) return [];

    const threshold = this.config.similarityThreshold;
    const scored: Array<{ path: string; similarity: number; topTerm: string }> = [];

    for (const [otherPath, b] of vectors) {
      if (otherPath === filePath) continue;

      const { dot, topTerm } = this.dotProductWithTopTerm(a.vec, b.vec);
      const similarity = dot / (a.mag * b.mag);

      if (similarity >= threshold && topTerm) {
        scored.push({ path: otherPath, similarity, topTerm });
      }
    }

    const edges: Edge[] = [];
    for (const match of this.topMatches(scored)) {
      const count = Math.round(match.similarity * 100);
      edges.push(
        { source: filePath, target: match.path, type: 'similar', noun: match.topTerm, count },
        { source: match.path, target: filePath, type: 'similar', noun: match.topTerm, count },
      );
    }

    return edges;
  }

  /**
   * Compute ALL edges for the entire corpus.
   * Uses upper-triangle iteration since cosine similarity is symmetric.
   */
  computeAllEdges(notebookId: string): Edge[] {
    if (!this.config.similarityEnabled) return [];
    const corpus = this.corpora.get(notebookId);
    if (!corpus || corpus.docCount < 2) return [];

    const threshold = this.config.similarityThreshold;
    const entries = Array.from(this.vectors(corpus).entries());

    // path -> its candidate matches, so the cap can be applied per note.
    const candidates = new Map<
      string,
      Array<{ path: string; similarity: number; topTerm: string }>
    >();
    const record = (
      from: string,
      to: string,
      similarity: number,
      topTerm: string,
    ): void => {
      let list = candidates.get(from);
      if (!list) {
        list = [];
        candidates.set(from, list);
      }
      list.push({ path: to, similarity, topTerm });
    };

    for (let i = 0; i < entries.length; i++) {
      for (let j = i + 1; j < entries.length; j++) {
        const [pathA, a] = entries[i];
        const [pathB, b] = entries[j];

        const { dot, topTerm } = this.dotProductWithTopTerm(a.vec, b.vec);
        const similarity = dot / (a.mag * b.mag);

        if (similarity >= threshold && topTerm) {
          record(pathA, pathB, similarity, topTerm);
          record(pathB, pathA, similarity, topTerm);
        }
      }
    }

    // A pair survives if either endpoint ranks it in its own top matches, so
    // capping never silently strips a note's strongest relationship.
    const kept = new Map<string, { similarity: number; topTerm: string }>();
    for (const [from, list] of candidates) {
      for (const match of this.topMatches(list)) {
        const key = from < match.path ? `${from}\u0000${match.path}` : `${match.path}\u0000${from}`;
        if (!kept.has(key)) {
          kept.set(key, { similarity: match.similarity, topTerm: match.topTerm });
        }
      }
    }

    const edges: Edge[] = [];
    for (const [key, { similarity, topTerm }] of kept) {
      const [pathA, pathB] = key.split('\u0000');
      const count = Math.round(similarity * 100);
      edges.push(
        { source: pathA, target: pathB, type: 'similar', noun: topTerm, count },
        { source: pathB, target: pathA, type: 'similar', noun: topTerm, count },
      );
    }

    return edges;
  }

  /**
   * TF-IDF vectors for every document, recomputed only when the corpus has
   * changed since the cache was built. Without this, a single file edit
   * re-vectorizes the whole notebook on every save.
   */
  private vectors(corpus: TfidfCorpus): Map<string, CachedVector> {
    if (corpus.cacheVersion === corpus.version) return corpus.cache;

    const cache = new Map<string, CachedVector>();
    for (const [filePath, terms] of corpus.tf) {
      if (terms.size === 0) continue;
      const vec = this.computeTfidfVector(terms, corpus);
      const mag = this.magnitude(vec);
      if (mag === 0) continue;
      cache.set(filePath, { vec, mag });
    }

    corpus.cache = cache;
    corpus.cacheVersion = corpus.version;
    return cache;
  }

  /** Strongest matches for one note, bounded by `maxSimilarPerNote`. */
  private topMatches<T extends { similarity: number }>(matches: T[]): T[] {
    const limit = this.config.maxSimilarPerNote;
    if (matches.length <= limit) return matches;
    return [...matches].sort((a, b) => b.similarity - a.similarity).slice(0, limit);
  }

  serialize(notebookId: string): TfidfPersisted | null {
    const corpus = this.corpora.get(notebookId);
    if (!corpus) return null;

    const tf: Record<string, Record<string, number>> = {};
    for (const [filePath, terms] of corpus.tf) {
      const record: Record<string, number> = {};
      for (const [term, count] of terms) {
        record[term] = count;
      }
      tf[filePath] = record;
    }

    const df: Record<string, number> = {};
    for (const [term, count] of corpus.df) {
      df[term] = count;
    }

    return { tf, df };
  }

  deserialize(notebookId: string, data: TfidfPersisted): void {
    const corpus = this.getOrCreateCorpus(notebookId);

    for (const [filePath, terms] of Object.entries(data.tf)) {
      const termMap = new Map<string, number>();
      for (const [term, count] of Object.entries(terms)) {
        termMap.set(term, count);
      }
      corpus.tf.set(filePath, termMap);
    }

    for (const [term, count] of Object.entries(data.df)) {
      corpus.df.set(term, count);
    }

    corpus.docCount = corpus.tf.size;
    corpus.version++;
  }

  private computeTfidfVector(
    terms: Map<string, number>,
    corpus: TfidfCorpus,
  ): Map<string, number> {
    const vec = new Map<string, number>();
    const n = corpus.docCount;

    for (const [term, rawTf] of terms) {
      const docFreq = corpus.df.get(term);
      if (!docFreq || docFreq === 0) continue;
      const idf = Math.log(n / docFreq);
      if (idf === 0) continue; // Term appears in every document — not discriminative
      vec.set(term, rawTf * idf);
    }

    return vec;
  }

  private magnitude(vec: Map<string, number>): number {
    let sum = 0;
    for (const v of vec.values()) {
      sum += v * v;
    }
    return Math.sqrt(sum);
  }

  /**
   * Compute dot product of two sparse TF-IDF vectors.
   * Also tracks which term contributed the most to the dot product
   * (highest a[t] * b[t] product) — this becomes the Edge.noun.
   */
  private dotProductWithTopTerm(
    vecA: Map<string, number>,
    vecB: Map<string, number>,
  ): { dot: number; topTerm: string | null } {
    let dot = 0;
    let topContribution = 0;
    let topTerm: string | null = null;

    // Iterate over the smaller vector for efficiency
    const [smaller, larger] =
      vecA.size <= vecB.size ? [vecA, vecB] : [vecB, vecA];

    for (const [term, valSmall] of smaller) {
      const valLarge = larger.get(term);
      if (valLarge === undefined) continue;

      const contribution = valSmall * valLarge;
      dot += contribution;

      if (contribution > topContribution) {
        topContribution = contribution;
        topTerm = term;
      }
    }

    return { dot, topTerm };
  }
}
