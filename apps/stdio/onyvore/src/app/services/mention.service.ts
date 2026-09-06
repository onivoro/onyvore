import { Injectable } from '@nestjs/common';
import type { Edge } from '@onivoro/isomorphic-onyvore';
import { TermStoreService } from './term-store.service';
import * as path from 'path';

/**
 * Computes `mention` edges: a noun phrase extracted from one note matching
 * another note's title.
 *
 * Only titles are match targets — if a concept matters enough to link to, it
 * should be its own note. Matching is case-insensitive, self-links are
 * excluded, and each (source, target) pair yields exactly one edge whose
 * `count` is the summed occurrences of every phrase that matched.
 */
@Injectable()
export class MentionService {
  /** notebookId -> (lowercase title variant -> set of file paths) */
  private titleIndexes = new Map<string, Map<string, Set<string>>>();
  /** notebookId -> (file path -> its registered title variants) */
  private fileTitles = new Map<string, Map<string, string[]>>();

  constructor(private readonly termStore: TermStoreService) {}

  removeNotebook(notebookId: string): void {
    this.titleIndexes.delete(notebookId);
    this.fileTitles.delete(notebookId);
  }

  /**
   * Register a file's title variants:
   * - basename without `.md` ("overview")
   * - for files in subdirectories, the parent directory plus basename
   *   ("work overview" for work/overview.md)
   *
   * The qualified variant disambiguates notes that share a basename; the bare
   * basename still matches both, which is correct when a note refers to the
   * concept generically.
   */
  registerFile(notebookId: string, relativePath: string): void {
    this.unregisterFile(notebookId, relativePath);

    const variants = this.titleVariants(relativePath);
    const index = this.getOrCreateIndex(notebookId);

    for (const variant of variants) {
      let paths = index.get(variant);
      if (!paths) {
        paths = new Set();
        index.set(variant, paths);
      }
      paths.add(relativePath);
    }

    this.getOrCreateFileTitles(notebookId).set(relativePath, variants);
  }

  unregisterFile(notebookId: string, relativePath: string): void {
    const titles = this.fileTitles.get(notebookId);
    const variants = titles?.get(relativePath);
    if (!variants) return;

    const index = this.titleIndexes.get(notebookId);
    if (index) {
      for (const variant of variants) {
        const paths = index.get(variant);
        if (!paths) continue;
        paths.delete(relativePath);
        if (paths.size === 0) index.delete(variant);
      }
    }

    titles!.delete(relativePath);
  }

  /** Edges from `sourceFile` to every note whose title it mentions. */
  computeOutboundEdges(notebookId: string, sourceFile: string): Edge[] {
    const terms = this.termStore.get(notebookId, sourceFile);
    const index = this.titleIndexes.get(notebookId);
    if (!terms || !index) return [];

    return this.aggregate(sourceFile, this.collectMatches(terms, index, sourceFile));
  }

  /**
   * Edges from every other note that mentions `targetFile`'s title.
   *
   * Needed when a note is created: notes already in the corpus may mention the
   * new title, and their cached terms are re-checked against it rather than
   * re-extracted.
   */
  computeInboundEdges(notebookId: string, targetFile: string): Edge[] {
    const store = this.termStore.getOrCreate(notebookId);
    const variants = this.fileTitles.get(notebookId)?.get(targetFile);
    if (!variants || variants.length === 0) return [];

    const variantSet = new Set(variants);
    const edges: Edge[] = [];

    for (const [sourceFile, terms] of store) {
      if (sourceFile === targetFile) continue;

      let total = 0;
      let topNoun = '';
      let topCount = 0;

      for (const variant of variantSet) {
        const count = terms.get(variant);
        if (count === undefined) continue;
        total += count;
        if (count > topCount) {
          topCount = count;
          topNoun = variant;
        }
      }

      if (total > 0) {
        edges.push({
          source: sourceFile,
          target: targetFile,
          type: 'mention',
          noun: topNoun,
          count: total,
        });
      }
    }

    return edges;
  }

  /** Every mention edge in the notebook. Used for full (re)builds. */
  computeAllEdges(notebookId: string): Edge[] {
    const store = this.termStore.getOrCreate(notebookId);
    const index = this.titleIndexes.get(notebookId);
    if (!index) return [];

    const edges: Edge[] = [];
    for (const sourceFile of store.keys()) {
      edges.push(...this.computeOutboundEdges(notebookId, sourceFile));
    }
    return edges;
  }

  titleVariants(relativePath: string): string[] {
    const basename = path.basename(relativePath, '.md').toLowerCase().trim();
    if (!basename) return [];

    const variants = [basename];
    const dir = path.dirname(relativePath);
    if (dir && dir !== '.') {
      const parent = path.basename(dir).toLowerCase().trim();
      if (parent) variants.push(`${parent} ${basename}`);
    }
    return variants;
  }

  /** target path -> (matched phrase -> occurrences) */
  private collectMatches(
    terms: Map<string, number>,
    index: Map<string, Set<string>>,
    sourceFile: string,
  ): Map<string, Map<string, number>> {
    const matches = new Map<string, Map<string, number>>();

    for (const [term, count] of terms) {
      const targets = index.get(term);
      if (!targets) continue;

      for (const target of targets) {
        if (target === sourceFile) continue; // self-links are not edges
        let perPhrase = matches.get(target);
        if (!perPhrase) {
          perPhrase = new Map();
          matches.set(target, perPhrase);
        }
        perPhrase.set(term, (perPhrase.get(term) ?? 0) + count);
      }
    }

    return matches;
  }

  /**
   * Collapse per-phrase matches into one edge per (source, target): counts sum,
   * and `noun` is the single phrase that contributed most.
   */
  private aggregate(
    sourceFile: string,
    matches: Map<string, Map<string, number>>,
  ): Edge[] {
    const edges: Edge[] = [];

    for (const [target, perPhrase] of matches) {
      let total = 0;
      let topNoun = '';
      let topCount = 0;

      for (const [phrase, count] of perPhrase) {
        total += count;
        if (count > topCount) {
          topCount = count;
          topNoun = phrase;
        }
      }

      if (total > 0) {
        edges.push({
          source: sourceFile,
          target,
          type: 'mention',
          noun: topNoun,
          count: total,
        });
      }
    }

    return edges;
  }

  private getOrCreateIndex(notebookId: string): Map<string, Set<string>> {
    let index = this.titleIndexes.get(notebookId);
    if (!index) {
      index = new Map();
      this.titleIndexes.set(notebookId, index);
    }
    return index;
  }

  private getOrCreateFileTitles(notebookId: string): Map<string, string[]> {
    let titles = this.fileTitles.get(notebookId);
    if (!titles) {
      titles = new Map();
      this.fileTitles.set(notebookId, titles);
    }
    return titles;
  }
}
