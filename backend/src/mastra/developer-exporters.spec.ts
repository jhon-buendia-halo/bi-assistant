import { DEFAULT_DEVELOPER_SETTINGS } from '../infrastructure/developer-settings/developer-settings.file';
import {
  developerTraceExporters,
  PHOENIX_PROJECT_NAME,
} from './developer-exporters';

describe('developerTraceExporters', () => {
  it('adds nothing and loads nothing when developer observability is off', () => {
    const load = jest.fn();

    expect(developerTraceExporters(DEFAULT_DEVELOPER_SETTINGS, load)).toEqual(
      [],
    );
    expect(load).not.toHaveBeenCalled();
  });

  it('adds a Phoenix exporter for the active endpoint when it is on', () => {
    const ArizeExporter = jest.fn();
    const load = jest.fn().mockReturnValue({ ArizeExporter });

    const exporters = developerTraceExporters(
      {
        ...DEFAULT_DEVELOPER_SETTINGS,
        observabilityEnabled: true,
        phoenixEndpoint: 'http://phoenix:6006',
      },
      load,
    );

    expect(exporters).toHaveLength(1);
    expect(ArizeExporter).toHaveBeenCalledWith({
      endpoint: 'http://phoenix:6006/v1/traces',
      projectName: PHOENIX_PROJECT_NAME,
    });
  });

  it('warns once and keeps only the local store when the exporter fails to load', () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const load = jest.fn(() => {
      throw new Error('missing');
    });

    expect(
      developerTraceExporters(
        { ...DEFAULT_DEVELOPER_SETTINGS, observabilityEnabled: true },
        load,
      ),
    ).toEqual([]);
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });
});
