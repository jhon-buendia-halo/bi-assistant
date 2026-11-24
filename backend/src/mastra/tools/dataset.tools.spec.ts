import { RequestContext } from '@mastra/core/request-context';
import { setDatasetToolServices } from '../tool-services';
import type { DatasetSnapshot, DatasetToolServices } from '../tool-services';
import {
  DATASETS_CONTEXT_KEY,
  describeEntityTool,
  runReadOnlySqlTool,
} from './dataset.tools';

type Execute = (
  input: Record<string, unknown>,
  context: { requestContext: RequestContext },
) => Promise<unknown>;

const describeEntity = describeEntityTool.execute as unknown as Execute;
const runReadOnlySql = runReadOnlySqlTool.execute as unknown as Execute;

function servicesWith(datasets: DatasetSnapshot[]): DatasetToolServices {
  return {
    getDatasets: jest.fn().mockResolvedValue(datasets),
    sampleRows: jest.fn(),
    runReadOnlySql: jest.fn().mockResolvedValue({ columns: [], rows: [] }),
    createVisual: jest.fn(),
    updateVisual: jest.fn(),
    restTarget: jest.fn(),
    exportRfpPackage: jest.fn(),
    showPanelItem: jest.fn(),
    updateWorkflow: jest.fn(),
  };
}

describe('datasource resolution errors (agents.md 3, BA-250)', () => {
  let requestContext: RequestContext;

  beforeEach(() => {
    setDatasetToolServices(
      servicesWith([
        {
          name: 'Core',
          datasourceId: 'ds-1',
          datasourceKind: 'postgres',
          tables: ['db.world_cup.matches'],
        },
        {
          name: 'Feed',
          datasourceId: 'ds-2',
          datasourceKind: 'rest',
          tables: ['api.feed.events'],
        },
      ]),
    );
    requestContext = new RequestContext();
    requestContext.set(DATASETS_CONTEXT_KEY, ['Core', 'Feed']);
  });

  it('names the id that has the entity when a wrong one is given', async () => {
    const result = await describeEntity(
      { entity: 'db.world_cup.matches', datasourceId: 'postgres ds-1' },
      { requestContext },
    );

    expect(result).toEqual({
      error:
        'Entity "db.world_cup.matches" is not available from datasource "postgres ds-1" in this session. Options: ds-1 (postgres)',
    });
  });

  it('says an entity is outside the session even when an id is given', async () => {
    const result = await describeEntity(
      { entity: 'db.world_cup.players', datasourceId: 'ds-1' },
      { requestContext },
    );

    expect(result).toEqual({
      error:
        'Entity "db.world_cup.players" is not part of this session\'s datasets',
    });
  });

  it('lists the session datasources when the SQL tool gets an unknown id', async () => {
    const result = await runReadOnlySql(
      {
        sql: 'SELECT 1',
        datasourceId: 'postgres ds-1',
        rationale: 'Check the connection.',
      },
      { requestContext },
    );

    expect(result).toEqual({
      error:
        'Datasource "postgres ds-1" is not used by this session\'s datasets. Options: ds-1 (postgres), ds-2 (rest)',
    });
  });

  it('still resolves the right id', async () => {
    const result = await describeEntity(
      { entity: 'db.world_cup.matches', datasourceId: 'ds-1' },
      { requestContext },
    );

    expect(result).toMatchObject({
      entity: 'db.world_cup.matches',
      datasourceId: 'ds-1',
      datasourceKind: 'postgres',
    });
  });
});
