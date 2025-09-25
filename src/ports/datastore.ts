import type { User, Ledger, Transaction, DateRange, TxType } from '../domain/types';

export interface IDataStore {
  getCurrentUser(): Promise<User | null>;
  register(input: { username: string; password?: string }): Promise<User>;
  login(input: { username: string; password?: string }): Promise<User>;
  logout(): Promise<void>;

  getInitialBalance(userId: string): Promise<number | null>;
  setInitialBalance(userId: string, amount: number): Promise<void>;

  addTransaction(tx: Transaction): Promise<void>;
  updateTransaction(tx: Transaction): Promise<void>;
  removeTransaction(id: string): Promise<void>;
  listTransactions(filter?: { userId?: string; range?: DateRange; type?: TxType }): Promise<Transaction[]>;
}

