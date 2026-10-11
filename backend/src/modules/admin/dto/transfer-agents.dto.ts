/** Body of `POST /admin/agents/transfer` (api.md 86). */
export class TransferAgentsDto {
  agentIds: string[];
  toUserId: string;
}
