export interface LinkEntry {
  notePath: string;
  noteTitle: string;
  noun: string;
  count: number;
}

export interface LinksForNote {
  notePath: string;
  outbound: LinkEntry[];
  inbound: LinkEntry[];
}
