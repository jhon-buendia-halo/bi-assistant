import { DEFAULT_DEVELOPER_SETTINGS } from '../developer-settings/developer-settings.file';
import { startDeveloperTelemetry } from './developer-telemetry';

describe('startDeveloperTelemetry', () => {
  it('loads nothing when developer observability is off', async () => {
    const load = jest.fn();

    await expect(
      startDeveloperTelemetry(DEFAULT_DEVELOPER_SETTINGS, load),
    ).resolves.toBeNull();
    expect(load).not.toHaveBeenCalled();
    expect(
      Object.keys(require.cache).filter((path) =>
        path.includes('@opentelemetry'),
      ),
    ).toEqual([]);
  });

  it('starts the SDK with the active setting when it is on', async () => {
    const handle = { shutdown: jest.fn() };
    const load = jest.fn().mockResolvedValue(handle);
    const settings = {
      ...DEFAULT_DEVELOPER_SETTINGS,
      observabilityEnabled: true,
      otlpEndpoint: 'http://collector:4318',
    };

    await expect(startDeveloperTelemetry(settings, load)).resolves.toBe(handle);
    expect(load).toHaveBeenCalledWith(settings);
  });

  it('warns once and carries on when the SDK fails to start', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const load = jest.fn().mockRejectedValue(new Error('boom'));

    await expect(
      startDeveloperTelemetry(
        { ...DEFAULT_DEVELOPER_SETTINGS, observabilityEnabled: true },
        load,
      ),
    ).resolves.toBeNull();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toContain(
      'OpenTelemetry did not start: boom',
    );
    warn.mockRestore();
  });
});
