import { Injectable } from '@nestjs/common';

/** relativePath -> (normalized term -> occurrence count) */
export type NotebookTerms = Map<string, Map<string, number>>;

/**
 * Single owner of per-document term vectors.
 *
 * Both TfidfService (similarity) and MentionService (title matching) read the
 * same maps, so extracted terms are stored once per notebook rather than once
 * per consumer — the difference matters at the 10k-note target.
 */
@Injectable()
export class TermStoreService {
  private stores = new Map<string, NotebookTerms>();

  getOrCreate(notebookId: string): NotebookTerms {
    let store = this.stores.get(notebookId);
    if (!store) {
      store = new Map();
      this.stores.set(notebookId, store);
    }
    return store;
  }

  get(notebookId: string, relativePath: string): Map<string, number> | undefined {
    return this.stores.get(notebookId)?.get(relativePath);
  }

  /** Re-key a document's terms. Used on rename, where the terms are unchanged. */
  move(notebookId: string, from: string, to: string): boolean {
    const store = this.stores.get(notebookId);
    const terms = store?.get(from);
    if (!store || !terms) return false;

    store.delete(from);
    store.set(to, terms);
    return true;
  }

  remove(notebookId: string): void {
    this.stores.delete(notebookId);
  }
}
