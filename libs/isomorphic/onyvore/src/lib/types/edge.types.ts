export type EdgeType = 'implicit' | 'explicit';

export interface Edge {
  source: string;
  target: string;
  type: EdgeType;
  noun: string;
  displayText?: string;
  count: number;
}
