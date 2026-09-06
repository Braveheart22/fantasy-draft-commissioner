export interface TransactionPort<TMetadata, TTransaction> {
  execute<T>(metadata: TMetadata, operation: (transaction: TTransaction) => T | Promise<T>): Promise<T>;
}
