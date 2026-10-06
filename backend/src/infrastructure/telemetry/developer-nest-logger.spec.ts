const mockEmit = jest.fn();
jest.mock('@opentelemetry/api-logs', () => ({
  ...jest.requireActual<object>('@opentelemetry/api-logs'),
  logs: { getLogger: () => ({ emit: mockEmit }) },
}));

import { ConsoleLogger } from '@nestjs/common';
import { SeverityNumber } from '@opentelemetry/api-logs';
import { installNestLogExport } from './developer-nest-logger';

describe('installNestLogExport', () => {
  it('prints as before and emits one log record per message', () => {
    const write = jest
      .spyOn(process.stdout, 'write')
      .mockImplementation(() => true);
    installNestLogExport();
    installNestLogExport(); // idempotent: no double emit

    new ConsoleLogger('PostgresConnector', { colors: false }).warn(
      'Postgres call failed',
    );

    expect(write).toHaveBeenCalledWith(
      expect.stringContaining('[PostgresConnector] Postgres call failed'),
    );
    expect(mockEmit).toHaveBeenCalledTimes(1);
    expect(mockEmit).toHaveBeenCalledWith({
      severityNumber: SeverityNumber.WARN,
      severityText: 'WARN',
      body: 'Postgres call failed',
      attributes: { 'log.context': 'PostgresConnector' },
    });
    write.mockRestore();
  });
});
