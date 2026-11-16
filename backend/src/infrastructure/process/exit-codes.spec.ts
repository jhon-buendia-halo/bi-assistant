import {
  PORT_IN_USE_EXIT_CODE,
  PortInUseError,
  bootstrapExitCode,
  isAddressInUse,
} from './exit-codes';

describe('backend exit codes (api.md 4.3 Port in use)', () => {
  it('uses 98 for a taken port', () => {
    expect(PORT_IN_USE_EXIT_CODE).toBe(98);
  });

  it('recognises an EADDRINUSE error', () => {
    const error = Object.assign(new Error('listen EADDRINUSE'), {
      code: 'EADDRINUSE',
    });
    expect(isAddressInUse(error)).toBe(true);
    expect(isAddressInUse(new Error('boom'))).toBe(false);
    expect(isAddressInUse(undefined)).toBe(false);
  });

  it('names the port in one line', () => {
    const error = new PortInUseError(3000);
    expect(error.message).toBe(
      'Port 3000 is already in use by another process',
    );
    expect(error.message).not.toContain('\n');
  });

  it('maps a port-in-use failure to 98 and anything else to 1', () => {
    expect(bootstrapExitCode(new PortInUseError(3000))).toBe(98);
    expect(bootstrapExitCode(new Error('boom'))).toBe(1);
    expect(bootstrapExitCode('boom')).toBe(1);
  });
});
