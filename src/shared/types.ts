export type JoinCodeStatus = "active" | "used" | "revoked";

export interface CodeLedgerEvent {
  id: string;
  label: string;
  at: string;
  prevHash?: string;
  hash?: string;
  [key: string]: any;
}

export interface SignedJoinCodeFields {
  codeSignature?: string;
  codeSignatureVersion?: "hmac-sha256-v1" | string;
  codeSignatureCreatedAt?: string;
}

export interface SharingRingNode {
  id: string;
  label: string;
  kind: "device" | "student";
  risk: number;
  count?: number;
}

export interface SharingRingEdge {
  from: string;
  to: string;
  weight: number;
}

export interface SharingRingGraph {
  nodes: SharingRingNode[];
  edges: SharingRingEdge[];
  rings: Array<{ id: string; risk: number; students: number; devices: number }>;
}
