import { Injectable } from '@nestjs/common';
import nlp from 'compromise';
import { STOP_NOUNS } from '@onivoro/isomorphic-onyvore';

@Injectable()
export class NlpService {
  /**
   * Extract lemmatized noun terms from content.
   * Uses compromise for POS tagging, noun extraction, and singular-form lemmatization.
   * Returns a Map of normalized term -> occurrence count.
   */
  extractTerms(content: string): Map<string, number> {
    const doc = nlp(content);
    const rawPhrases: string[] = doc.nouns().toSingular().out('array');
    const terms = new Map<string, number>();

    for (const raw of rawPhrases) {
      const normalized = raw.toLowerCase().trim().replace(/[^\w\s-]/g, '');
      if (normalized.length <= 1) continue;

      const words = normalized.split(/\s+/);

      // Full phrase — keep if not a stop noun
      if (!STOP_NOUNS.has(normalized)) {
        terms.set(normalized, (terms.get(normalized) ?? 0) + 1);
      }

      // Decompose multi-word phrases into individual words
      if (words.length > 1) {
        for (const word of words) {
          if (word.length <= 1) continue;
          if (STOP_NOUNS.has(word)) continue;
          terms.set(word, (terms.get(word) ?? 0) + 1);
        }
      }
    }

    return terms;
  }
}
