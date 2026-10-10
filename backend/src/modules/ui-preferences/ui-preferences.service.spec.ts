import type { UiPreferencesDoc } from './entities/ui-preferences.entity';
import type { UiPreferencesRepository } from './repositories/ui-preferences.repository';
import { UiPreferencesService } from './ui-preferences.service';

function serviceWith(initial: UiPreferencesDoc | null = null) {
  let doc = initial;
  const repository = {
    get: jest.fn(() => Promise.resolve(doc)),
    patch: jest.fn((patch: Partial<UiPreferencesDoc>) => {
      doc = { ...(doc ?? { key: 'ui-preferences' }), ...patch };
      return Promise.resolve(doc);
    }),
  };
  return {
    service: new UiPreferencesService(
      repository as unknown as UiPreferencesRepository,
    ),
    repository,
  };
}

describe('UiPreferencesService', () => {
  it('reports never-chosen values as null', async () => {
    await expect(serviceWith().service.get()).resolves.toEqual({
      theme: null,
      navExpanded: null,
    });
  });

  it('reads an invalid stored value as never chosen', async () => {
    const { service } = serviceWith({
      key: 'ui-preferences',
      theme: 'sepia' as never,
      navExpanded: 'yes' as never,
    });
    await expect(service.get()).resolves.toEqual({
      theme: null,
      navExpanded: null,
    });
  });

  it('changes only the fields sent', async () => {
    const { service } = serviceWith({
      key: 'ui-preferences',
      theme: 'dark',
    });
    await expect(service.save({ navExpanded: false })).resolves.toEqual({
      theme: 'dark',
      navExpanded: false,
    });
  });

  it('rejects an unknown theme and a non-boolean drawer state', async () => {
    const { service, repository } = serviceWith();
    await expect(service.save({ theme: 'sepia' })).rejects.toThrow(
      'theme must be one of: system, light, dark',
    );
    await expect(service.save({ navExpanded: 'true' })).rejects.toThrow(
      'navExpanded must be true or false',
    );
    expect(repository.patch).not.toHaveBeenCalled();
  });
});
