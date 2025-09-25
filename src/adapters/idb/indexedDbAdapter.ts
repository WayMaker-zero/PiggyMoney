import type { IDataStore } from '../../ports/datastore';
import type { User, Transaction, DateRange } from '../../domain/types';
import { uuid } from '../../utils/uuid';

const DB_NAME = 'piggy-money';
const DB_VERSION = 1;

export class IndexedDbAdapter implements IDataStore {
  private dbPromise: Promise<IDBDatabase>;

  constructor(){
    this.dbPromise = this.open();
  }

  private open(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains('users')) {
          db.createObjectStore('users', { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains('ledger')) {
          db.createObjectStore('ledger', { keyPath: 'userId' });
        }
        if (!db.objectStoreNames.contains('transactions')) {
          const store = db.createObjectStore('transactions', { keyPath: 'id' });
          store.createIndex('userId', 'userId', { unique: false });
          store.createIndex('userId_date', ['userId','date'], { unique: false });
        }
        if (!db.objectStoreNames.contains('meta')) {
          db.createObjectStore('meta', { keyPath: 'key' });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  private async tx<T=void>(stores: string[], mode: IDBTransactionMode, fn: (tx: IDBTransaction) => Promise<T> | T): Promise<T> {
    const db = await this.dbPromise;
    return new Promise<T>((resolve, reject) => {
      const tx = db.transaction(stores, mode);
      const done = (v: T) => resolve(v);
      const fail = (e: any) => reject(e);
      tx.oncomplete = () => {};
      tx.onerror = () => fail(tx.error);
      Promise.resolve(fn(tx)).then(done, fail);
    });
  }

  async getCurrentUser(): Promise<User | null> {
    return this.tx(['meta','users'], 'readonly', async (tx) => {
      const meta = tx.objectStore('meta');
      const keyReq = meta.get('currentUserId');
      const userId: string = await reqAsync(keyReq);
      if (!userId) return null;
      const uReq = tx.objectStore('users').get(userId);
      return await reqAsync(uReq);
    });
  }

  async register(input: { username: string; password?: string }): Promise<User> {
    const user: User = { id: uuid(), username: input.username, createdAt: Date.now() };
    await this.tx(['users','meta'], 'readwrite', async (tx) => {
      await reqAsync(tx.objectStore('users').add(user));
      await reqAsync(tx.objectStore('meta').put({ key: 'currentUserId', value: user.id }));
    });
    return user;
  }

  async login(input: { username: string; password?: string }): Promise<User> {
    return this.tx(['users','meta'], 'readwrite', async (tx) => {
      const all = await getAll<User>(tx.objectStore('users'));
      const found = all.find(u => u.username === input.username);
      if (!found) throw new Error('用户不存在');
      await reqAsync(tx.objectStore('meta').put({ key: 'currentUserId', value: found.id }));
      return found;
    });
  }

  async logout(): Promise<void> {
    await this.tx(['meta'], 'readwrite', async (tx) => {
      await reqAsync(tx.objectStore('meta').delete('currentUserId'));
    });
  }

  async getInitialBalance(userId: string): Promise<number | null> {
    return this.tx(['ledger'], 'readonly', async (tx) => {
      const data = await reqAsync(tx.objectStore('ledger').get(userId));
      return data?.initialBalance ?? null;
    });
  }

  async setInitialBalance(userId: string, amount: number): Promise<void> {
    await this.tx(['ledger'], 'readwrite', async (tx) => {
      await reqAsync(tx.objectStore('ledger').put({ userId, initialBalance: amount, createdAt: Date.now() }));
    });
  }

  async addTransaction(txn: Transaction): Promise<void> {
    await this.tx(['transactions'], 'readwrite', async (tx) => {
      if (!txn.id) txn.id = uuid();
      await reqAsync(tx.objectStore('transactions').add(txn));
    });
  }

  async updateTransaction(txn: Transaction): Promise<void> {
    await this.tx(['transactions'], 'readwrite', async (tx) => {
      await reqAsync(tx.objectStore('transactions').put(txn));
    });
  }

  async removeTransaction(id: string): Promise<void> {
    await this.tx(['transactions'], 'readwrite', async (tx) => {
      await reqAsync(tx.objectStore('transactions').delete(id));
    });
  }

  async listTransactions(filter?: { userId?: string; range?: DateRange; type?: 'income'|'expense' }): Promise<Transaction[]> {
    return this.tx(['transactions'], 'readonly', async (tx) => {
      const store = tx.objectStore('transactions');
      let list = await getAll<Transaction>(store);
      if (filter?.userId) list = list.filter(x => x.userId === filter.userId);
      if (filter?.range) list = list.filter(x => x.date >= filter.range.start && x.date <= filter.range.end);
      if (filter?.type) list = list.filter(x => x.type === filter.type);
      list.sort((a,b) => a.date.localeCompare(b.date));
      return list;
    });
  }
}

function reqAsync<T = any>(req: IDBRequest<any>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function getAll<T = any>(store: IDBObjectStore): Promise<T[]> {
  if ('getAll' in store) {
    return reqAsync(store.getAll());
  }
  return new Promise((resolve, reject) => {
    const out: T[] = [];
    const cursorReq = store.openCursor();
    cursorReq.onsuccess = () => {
      const cursor = cursorReq.result as IDBCursorWithValue | null;
      if (!cursor) return resolve(out);
      out.push(cursor.value as T);
      cursor.continue();
    };
    cursorReq.onerror = () => reject(cursorReq.error);
  });
}

