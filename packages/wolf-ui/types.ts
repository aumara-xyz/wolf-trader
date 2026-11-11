export interface Outcome { name: string; assetId: string; price?: string | number | null }
export interface Market {
  id: string; question: string; url?: string; slug?: string; outcomes: Outcome[];
  rules?: string; description?: string; active?: boolean; closed?: boolean; acceptingOrders?: boolean;
  supported?: boolean; unsupportedReasons?: string[]; protocolVersion?: string;
  observedAt?: string; fetchedAt?: string; receivedAt?: string; endDate?: string; closeTime?: string; quantityStep?: string;
  fee?: { known?: boolean; rateBps?: string | number; feeRate?: string | number; model?: string };
}
export interface Position { marketId: string; assetId: string; question?: string; outcome: string; quantity: string; costBasis: string; url?: string; estimatedSellValue?: string | null; unrealizedPnl?: string | null; markObservedAt?: string; markStatus?: string }
export interface Portfolio { account: { epoch: string; revision: number; cash: string; startingCash: string }; positions: Position[]; estimatedSellValue?: string | null; estimatedTotal?: string | null; valuationComplete?: boolean }
export interface Quote {
  id: string; accountEpoch: string; accountRevision: number; side: 'BUY' | 'SELL'; quantity: string;
  debit?: string; proceeds?: string; fee?: string; averagePrice?: string; expiresAt: string; createdAt?: string;
  marketId?: string; assetId?: string; [key: string]: unknown;
}
export interface Draft { assetId: string; side: 'BUY' | 'SELL'; amount: string; quantity: string }
export interface Source { title?: string; url: string }
export interface ResearchAnswer { sessionId?: string; mode: string; answer: string; markets?: Market[]; sources?: Source[]; opportunities?: { marketId: string; relevance?: string; countercase?: string; sources?: Source[] }[] }
export interface Activity { id?: string; operationId?: string; kind?: string; type?: string; side?: string; question?: string; outcome?: string; quantity?: string; debit?: string; proceeds?: string; fee?: string; createdAt?: string; at?: string; [key: string]: unknown }
export interface Capabilities { marketData?: unknown; research?: unknown; [key: string]: unknown }
