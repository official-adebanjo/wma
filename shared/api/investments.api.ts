import { ApiClient } from './client';

/** Contract per Calculator Spec §5. Field names are the expected shape — confirm against the OpenAPI spec. */

export type ProductCode = 'REAP' | 'RWIN' | 'RTN';

export interface CatalogProduct {
  code: ProductCode;
  name: string;
  active: boolean;
  rates: Array<{ tenorDays?: number; tenorMonths?: number; ratePct: number; amountMin?: number; amountMax?: number }>;
  minAmount: number;
  maxAmount?: number;
  whtRatePct: number;
}

export interface CalculateRequest {
  productCode: ProductCode;
  principal: number;
  tenorDays?: number;
  tenorMonths?: number;
  interestTiming?: 'UPFRONT' | 'AT_MATURITY';
  frequency?: 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'ON_DEMAND';
  contributionAmount?: number;
}

export interface CalculateResponse {
  grossYield: number;
  wht: number;
  netPayout: number;
  netInterest?: number;
  ratePct: number;
  maturityDate?: string;
}

export interface CreateRequest extends CalculateRequest {
  planName?: string;
  autoRollover?: boolean;
  fundingSource: 'WALLET' | 'BANK_TRANSFER';
  idempotencyKey: string;
}

export class InvestmentsApi {
  constructor(private readonly api: ApiClient) {}

  catalog() {
    return this.api.get<{ products: CatalogProduct[] }>('/api/v1/investments/catalog');
  }

  calculate(req: CalculateRequest) {
    return this.api.post<CalculateResponse>('/api/v1/investments/calculate', req);
  }

  create(req: CreateRequest) {
    return this.api.post<{ id: string; state: string; ratePct: number }>('/api/v1/investments/create', req, {
      'Idempotency-Key': req.idempotencyKey,
    });
  }
}
