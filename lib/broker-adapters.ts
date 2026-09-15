export type BrokerMode = "paper" | "live";

export type BrokerOrderRequest = {
  orderId: string;
  proposalId: string;
  contract: Record<string, unknown>;
  order: Record<string, unknown>;
  approvalExpiresAt: string;
  idempotencyKey: string;
  maxEntryPrice: number;
  riskSnapshot: Record<string, unknown>;
};

export type BrokerSubmission = {
  mode: BrokerMode;
  status: "filled" | "pending";
  simulated: boolean;
  command: "paper_fill" | "place_order";
};

/**
 * Provider-independent order seam. The Site owns proposal and risk state;
 * concrete adapters only describe the execution boundary that the server
 * should use for the selected mode.
 */
export interface BrokerAdapter {
  readonly mode: BrokerMode;
  createSubmission(request: BrokerOrderRequest): BrokerSubmission;
}

export class PaperBrokerAdapter implements BrokerAdapter {
  readonly mode = "paper" as const;

  createSubmission(request: BrokerOrderRequest): BrokerSubmission {
    void request;
    return { mode: this.mode, status: "filled", simulated: true, command: "paper_fill" };
  }
}

export class IBKRBridgeAdapter implements BrokerAdapter {
  readonly mode: BrokerMode;

  constructor(mode: BrokerMode = "live") {
    this.mode = mode;
  }

  createSubmission(request: BrokerOrderRequest): BrokerSubmission {
    void request;
    return { mode: this.mode, status: "pending", simulated: false, command: "place_order" };
  }
}
