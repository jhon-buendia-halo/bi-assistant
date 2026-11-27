describe("Dana's readiness bridge (plan data-readiness-assessor 2)", () => {
  // A fresh module per test: the bridge is module state.
  const load = () => {
    let bridge!: typeof import('./readiness-tool-services');
    jest.isolateModules(() => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      bridge = require('./readiness-tool-services') as typeof bridge;
    });
    return bridge;
  };

  it('refuses to be read before the sessions service installs it', () => {
    const bridge = load();
    expect(() => bridge.getReadinessToolServices()).toThrow(
      'Readiness tool services not installed yet',
    );
  });

  it('serves what was installed', async () => {
    const bridge = load();
    const previous = jest.fn().mockResolvedValue(null);
    const save = jest.fn().mockResolvedValue(undefined);
    bridge.setReadinessToolServices({ previous, save });
    const services = bridge.getReadinessToolServices();
    await expect(services.previous('k')).resolves.toBeNull();
    expect(previous).toHaveBeenCalledWith('k');
    await services.save({ id: 'a-1' } as never);
    expect(save).toHaveBeenCalledWith({ id: 'a-1' });
  });
});
