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
  explicitOutbound: LinkEntry[];
  explicitInbound: LinkEntry[];
  implicitOutbound: LinkEntry[];
  implicitInbound: LinkEntry[];
}
