// The controller is a thin HTTP shell — stub the service module so the spec
// never loads Mastra, the doc store or any agent.
jest.mock('./sessions.service', () => ({ SessionsService: class {} }));

import { SessionsController } from './sessions.controller';

describe('SessionsController', () => {
  /** Just enough of an express `Response` for the SSE endpoint. */
  function sseResponse() {
    return {
      setHeader: jest.fn(),
      flushHeaders: jest.fn(),
      write: jest.fn(),
      once: jest.fn(),
      off: jest.fn(),
      end: jest.fn(),
      writableEnded: false,
    };
  }

  describe('POST :id/messages/stream', () => {
    const stream = async (body: Record<string, unknown>) => {
      const service = { streamMessage: jest.fn().mockResolvedValue(undefined) };
      const controller = new SessionsController(service as never);
      await controller.streamMessage('session-1', body, sseResponse() as never);
      return (service.streamMessage.mock.calls as unknown[][])[0];
    };

    it('turns answer pinning on by default', async () => {
      const args = await stream({ content: 'Net revenue FY2025?' });

      expect(args[0]).toBe('session-1');
      expect(args[1]).toBe('Net revenue FY2025?');
      expect(args.slice(4)).toEqual([undefined, false, false, true]);
    });

    it('lets the body opt a turn out with pin: false', async () => {
      const args = await stream({
        content: 'Net revenue FY2025?',
        expert: true,
        pin: false,
      });

      expect(args.slice(5)).toEqual([false, true, false]);
    });
  });

  describe('POST :id/expert/feedback', () => {
    const session = {
      id: 'session-1',
      name: 'Retail',
      datasets: [],
      messages: [],
    };

    it('names the learned lessons in the message and forwards them', async () => {
      const lessons = [
        {
          id: 'l1',
          kind: 'term',
          title: 'Fiscal year',
          body: '…',
          method: 'agent',
        },
        {
          id: 'l2',
          kind: 'term',
          title: 'Net revenue',
          body: '…',
          method: 'agent',
        },
      ];
      const service = {
        recordBlockFeedback: jest.fn().mockResolvedValue({ session, lessons }),
      };
      const controller = new SessionsController(service as never);

      const result = await controller.rateReasoningBlock('session-1', {
        messageAt: '2026-09-30T10:00:00.000Z',
        block: 'metric',
        comment: 'Net revenue is merchandise only.',
      });

      expect(result).toEqual({
        ok: true,
        message: 'Feedback saved — learned: Fiscal year, Net revenue',
        session,
        lessons,
      });
    });

    it('says only "Feedback saved" when nothing was learned', async () => {
      const service = {
        recordBlockFeedback: jest.fn().mockResolvedValue({ session }),
      };
      const controller = new SessionsController(service as never);

      const result = await controller.rateReasoningBlock('session-1', {
        messageAt: '2026-09-30T10:00:00.000Z',
        block: 'sql',
        vote: 'up',
      });

      expect(result).toEqual({ ok: true, message: 'Feedback saved', session });
    });

    it('reports a failure without throwing', async () => {
      const service = {
        recordBlockFeedback: jest
          .fn()
          .mockRejectedValue(new Error('This answer has no reasoning trace')),
      };
      const controller = new SessionsController(service as never);

      const result = await controller.rateReasoningBlock('session-1', {});

      expect(result).toEqual({
        ok: false,
        message: 'This answer has no reasoning trace',
      });
    });
  });
});
