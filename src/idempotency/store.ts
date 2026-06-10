type IdempotencyRecord<TData> = {
  actionId: string;
  payloadHash: string;
  response: TData;
};

export interface IdempotencyStore<TData> {
  get(key: string): IdempotencyRecord<TData> | undefined;
  set(key: string, record: IdempotencyRecord<TData>): void;
}

export class InMemoryIdempotencyStore<TData> implements IdempotencyStore<TData> {
  private readonly store = new Map<string, IdempotencyRecord<TData>>();

  get(key: string): IdempotencyRecord<TData> | undefined {
    return this.store.get(key);
  }

  set(key: string, record: IdempotencyRecord<TData>): void {
    this.store.set(key, record);
  }
}
