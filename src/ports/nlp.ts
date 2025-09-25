import type { Transaction } from '../domain/types';

export interface INlpParser {
  parse(text: string): Promise<Transaction[]>;
}

