export interface ICryptoProvider {
  encrypt(data: Uint8Array, password: string): Promise<Uint8Array>;
  decrypt(data: Uint8Array, password: string): Promise<Uint8Array>;
}

