export interface AuditEventRecord {
  id: string; seasonId: string; sequence: number; actorType: string; actorLabel: string;
  commandType: string; correlationId: string; idempotencyKey: string; reason?: string;
  beforeJson?: string; afterJson?: string; createdAt: string;
}
