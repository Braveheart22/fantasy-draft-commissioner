export interface ApiClient {
  expectedVersion(): number | undefined;
  activateVersion(version: number): void;
  request(path: string, method?: string, body?: unknown): Promise<any>;
}
export function createApiClient(fetcher?: typeof fetch): ApiClient;
export function createSeasonActivation(client: ApiClient, initialSnapshot?: any): { current(): any; activate(seasonId: string): Promise<any> };
