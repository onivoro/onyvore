import { Injectable } from '@nestjs/common';
import type { Edge } from '@onivoro/isomorphic-onyvore';
import { AppStdioOnyvoreConfig } from '../app-stdio-onyvore-config.class';

export interface TfidfPersisted {
  tf: Record<string, Record<string, number>>;
  df: Record<string, number>;
}

interface TfidfCorpus {
  /** Per-document term frequency vectors: filePath -> (term -> raw count) */
  tf: Map<string, Map<string, number>>;
  /** Document frequency: term -> number of documents containing the term */
  df: Map<string, number>;
  /** Total number of documents in corpus */
  docCount: number;
}

@Injectable()
export class TfidfService {
  private corpora = new Map<string, TfidfCorpus>();

  constructor(private readonly config: AppStdioOnyvoreConfig) {}

  getOrCreateCorpus(notebookId: string): TfidfCorpus {
    let corpus = this.corpora.get(notebookId);
    if (!corpus) {
      corpus = { tf: new Map(), df: new Map(), docCount: 0 };
      this.corpora.set(notebookId, corpus);
    }
    return corpus;
  }

  removeCorpus(notebookId: string): void {
    this.corpora.delete(notebookId);
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
  }

  /**
   * Compute all edges for a single document against the rest of the corpus.
   * Returns edges in BOTH directions (A->B and B->A) for each pair above threshold.
   */
  computeEdgesForDocument(notebookId: string, filePath: string): Edge[] {
    const corpus = this.corpora.get(notebookId);
    if (!corpus || corpus.docCount < 2) return [];

    const termsA = corpus.tf.get(filePath);
    if (!termsA || termsA.size === 0) return [];

    const vecA = this.computeTfidfVector(termsA, corpus);
    const magA = this.magnitude(vecA);
    if (magA === 0) return [];

    const threshold = this.config.similarityThreshold;
    const edges: Edge[] = [];

    for (const [otherPath, otherTerms] of corpus.tf) {
      if (otherPath === filePath) continue;
      if (otherTerms.size === 0) continue;

      const vecB = this.computeTfidfVector(otherTerms, corpus);
      const magB = this.magnitude(vecB);
      if (magB === 0) continue;

      const { dot, topTerm } = this.dotProductWithTopTerm(vecA, vecB);
      const similarity = dot / (magA * magB);

      if (similarity >= threshold && topTerm) {
        const count = Math.round(similarity * 100);
        edges.push(
          { source: filePath, target: otherPath, type: 'implicit', noun: topTerm, count },
          { source: otherPath, target: filePath, type: 'implicit', noun: topTerm, count },
        );
      }
    }

    return edges;
  }

  /**
   * Compute ALL edges for the entire corpus.
   * Uses upper-triangle optimization since cosine similarity is symmetric.
   */
  computeAllEdges(notebookId: string): Edge[] {
    const corpus = this.corpora.get(notebookId);
    if (!corpus || corpus.docCount < 2) return [];

    const threshold = this.config.similarityThreshold;

    // Pre-compute all TF-IDF vectors and magnitudes
    const entries: Array<{
      path: string;
      vec: Map<string, number>;
      mag: number;
    }> = [];

    for (const [filePath, terms] of corpus.tf) {
      if (terms.size === 0) continue;
      const vec = this.computeTfidfVector(terms, corpus);
      const mag = this.magnitude(vec);
      if (mag === 0) continue;
      entries.push({ path: filePath, vec, mag });
    }

    const edges: Edge[] = [];

    // Upper-triangle: only compute each pair once
    for (let i = 0; i < entries.length; i++) {
      for (let j = i + 1; j < entries.length; j++) {
        const a = entries[i];
        const b = entries[j];

        const { dot, topTerm } = this.dotProductWithTopTerm(a.vec, b.vec);
        const similarity = dot / (a.mag * b.mag);

        if (similarity >= threshold && topTerm) {
          const count = Math.round(similarity * 100);
          edges.push(
            { source: a.path, target: b.path, type: 'implicit', noun: topTerm, count },
            { source: b.path, target: a.path, type: 'implicit', noun: topTerm, count },
          );
        }
      }
    }

    return edges;
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
