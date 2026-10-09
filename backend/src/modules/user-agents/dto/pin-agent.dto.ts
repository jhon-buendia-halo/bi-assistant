/** `PUT /agents/:key/pin` payload; only `true` pins. */
export class PinAgentDto {
  pinned: boolean;
}
