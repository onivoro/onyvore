import { Injectable } from '@nestjs/common';
import nlp from 'compromise';
import { STOP_NOUNS } from '@onivoro/isomorphic-onyvore';

export interface ExtractionResult {
  phrases: Map<string, number>;
}

@Injectable()
export class NlpService {
  extractNounPhrases(content: string): ExtractionResult {
    const doc = nlp(content);
    const rawPhrases: string[] = doc.nouns().out('array');
    const phrases = new Map<string, number>();

    for (const raw of rawPhrases) {
      const normalized = raw.toLowerCase().trim().replace(/[^\w\s-]/g, '');
      if (normalized.length <= 1) continue;

      const words = normalized.split(/\s+/);

      // Full phrase — keep if not a stop noun
      if (!STOP_NOUNS.has(normalized)) {
        phrases.set(normalized, (phrases.get(normalized) ?? 0) + 1);
      }

      // Decompose multi-word phrases into individual words
      if (words.length > 1) {
        for (const word of words) {
          if (word.length <= 1) continue;
          if (STOP_NOUNS.has(word)) continue;
          phrases.set(word, (phrases.get(word) ?? 0) + 1);
        }
      }
    }

    return { phrases };
  }
}
