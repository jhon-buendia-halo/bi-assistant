import { BadRequestException } from '@nestjs/common';
import type { SessionsService, StreamEvent } from '../sessions.service';

/**
 * Test seam (1.23.27): a streamed agent turn over a stored session. Nothing in
 * the app starts a chat any more, but the turn engine still streams the same
 * turn for a run host, so the sessions unit suites keep proving the turn
 * behaviour (guards, workflow moves, cross-check, readiness, RFP context)
 * against a stored session through the engine directly.
 */
export async function streamStored(
  service: SessionsService,
  id: string,
  content: string,
  emit: (event: StreamEvent) => void = () => {},
  abortSignal?: AbortSignal,
  activeVisualId?: string,
  careful = false,
): Promise<void> {
  const trimmed = (content ?? '').trim();
  if (!trimmed) throw new BadRequestException('message is required');
  const session = await service.get(id);
  const engine = (
    service as unknown as {
      turns: {
        streamTurn(
          session: unknown,
          question: string,
          emit: (event: StreamEvent) => void,
          abortSignal?: AbortSignal,
          activeVisualId?: string,
          careful?: boolean,
        ): Promise<void>;
      };
    }
  ).turns;
  await engine.streamTurn(
    session,
    trimmed,
    emit,
    abortSignal,
    activeVisualId,
    careful,
  );
}
