export interface IBackupService {
  exportAsJson(userId: string, encrypted?: { enable: boolean; password?: string }): Promise<Blob>;
  importFromJson(blob: Blob, opts?: { password?: string; strategy?: 'overwrite'|'merge' }): Promise<void>;
  exportAsSqlite?(userId: string, encrypted?: { enable: boolean; password?: string }): Promise<Blob>;
  importFromSqlite?(blob: Blob, opts?: { password?: string; strategy?: 'overwrite'|'merge' }): Promise<void>;
}

