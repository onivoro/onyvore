import type { EdgeType } from './edge.types';

export interface LinkEntry {
  notePath: string;
  noteTitle: string;
  type: EdgeType;
  noun: string;
  displayText?: string;
  count: number;
}

export interface LinksForNote {
  notePath: string;
  /** Wikilinks this note authored. */
  explicitOutbound: LinkEntry[];
  /** Wikilinks pointing at this note. */
  explicitInbound: LinkEntry[];
  /** Notes whose titles this note mentions. */
  mentionOutbound: LinkEntry[];
  /** Notes that mention this note's title. */
  mentionInbound: LinkEntry[];
  /** Similar notes. Symmetric, so there is no direction to report. */
  similar: LinkEntry[];
}
