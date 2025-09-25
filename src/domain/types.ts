export type TxType = 'income' | 'expense';

export interface User {
  id: string;
  username: string;
  passwordHash?: string;
  createdAt: number;
}

export interface Ledger {
  userId: string;
  initialBalance: number;
  createdAt: number;
}

export interface Transaction {
  id: string;
  userId: string;
  amount: number;
  type: TxType;
  date: string; // ISO8601
  note?: string;
  tags?: string[];
}

export interface DateRange { start: string; end: string }
export interface Point { x: string; y: number }

