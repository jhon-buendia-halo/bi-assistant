import { z } from 'zod';
import { CODE_WORKFLOWS } from './workflow-catalog';
import {
  ContractViolationError,
  assertWorkflowContracts,
  checkWorkflowContract,
  contractHash,
  contractJsonSchema,
  schemaFieldNames,
  stepsOnEveryPath,
  withContract,
  type ContractWorkflow,
} from './workflow-contract';

const json = (schema: z.ZodType, io: 'input' | 'output' = 'output') =>
  contractJsonSchema(schema, io);

/** A workflow of the given steps, on a required text `question`. */
function workflow(
  steps: { id: string; input: z.ZodType; output: z.ZodType }[],
  input: ContractWorkflow['input'] = [
    { name: 'question', label: 'Question', type: 'text', required: true },
  ],
): ContractWorkflow {
  return {
    id: 'fixture',
    input,
    steps: steps.map((step) => ({
      id: step.id,
      inputSchema: json(step.input, 'input'),
      outputSchema: json(step.output),
    })),
  };
}

describe('contractJsonSchema and schemaFieldNames (api.md 117)', () => {
  const schema = z.object({
    question: z.string().describe('The question.'),
    datasets: z.array(z.string()),
    rowCount: z.number().optional(),
    kind: z.string().nullable(),
  });

  it('is an object schema with typed properties, items, descriptions and required, without $schema', () => {
    expect(json(schema)).toEqual({
      type: 'object',
      properties: {
        question: { type: 'string', description: 'The question.' },
        datasets: { type: 'array', items: { type: 'string' } },
        rowCount: { type: 'number' },
        kind: { type: ['string', 'null'] },
      },
      required: ['question', 'datasets', 'kind'],
      additionalProperties: false,
    });
  });

  it('derives the field names from the top-level properties, in schema order', () => {
    expect(schemaFieldNames(json(schema))).toEqual([
      'question',
      'datasets',
      'rowCount',
      'kind',
    ]);
    expect(schemaFieldNames({})).toEqual([]);
  });
});

describe('contractHash', () => {
  const base = workflow([
    {
      id: 'a',
      input: z.object({ question: z.string() }),
      output: z.object({ answer: z.string() }),
    },
  ]);

  it('is the first 12 hex of a sha256, the same for the same contract', () => {
    const again = workflow([
      {
        id: 'a',
        input: z.object({ question: z.string() }),
        output: z.object({ answer: z.string() }),
      },
    ]);
    expect(contractHash(base)).toMatch(/^[0-9a-f]{12}$/);
    expect(contractHash(again)).toBe(contractHash(base));
  });

  it('ignores key order and what is not the contract (labels, the workflow id)', () => {
    const reordered: ContractWorkflow = {
      steps: base.steps.map((step) => ({
        outputSchema: step.outputSchema,
        inputSchema: step.inputSchema,
        id: step.id,
      })),
      input: [{ ...base.input[0], label: 'Ask' }],
      id: 'other',
    };
    expect(contractHash(reordered)).toBe(contractHash(base));
  });

  it('changes when a schema, a step id or an input field type changes', () => {
    const hash = contractHash(base);
    const changedSchema = workflow([
      {
        id: 'a',
        input: z.object({ question: z.string() }),
        output: z.object({ answer: z.number() }),
      },
    ]);
    const changedId = { ...base, steps: [{ ...base.steps[0], id: 'b' }] };
    const changedField: ContractWorkflow = {
      ...base,
      input: [{ ...base.input[0], type: 'textarea' }],
    };
    expect(contractHash(changedSchema)).not.toBe(hash);
    expect(contractHash(changedId)).not.toBe(hash);
    expect(contractHash(changedField)).not.toBe(hash);
  });

  it("changes with the edges' flow, not with their labels", () => {
    const edges: ContractWorkflow['edges'] = [
      { from: 'start', to: 'a', kind: 'next', label: 'Go' },
      { from: 'a', to: 'end', kind: 'next' },
    ];
    const withEdges = { ...base, edges };
    expect(contractHash(withEdges)).not.toBe(contractHash(base));
    expect(
      contractHash({
        ...base,
        edges: [{ ...edges[0], label: 'Start' }, edges[1]],
      }),
    ).toBe(contractHash(withEdges));
    expect(
      contractHash({
        ...base,
        edges: [{ ...edges[0], kind: 'branch' }, edges[1]],
      }),
    ).not.toBe(contractHash(withEdges));
  });
});

describe('stepsOnEveryPath and the edge-following check (agents.md 5.12)', () => {
  // start → a → (b | c) → d, with a loop d → b.
  const steps = [
    {
      id: 'a',
      input: z.object({ question: z.string() }),
      output: z.object({ question: z.string(), plan: z.string() }),
    },
    {
      id: 'b',
      input: z.object({ plan: z.string() }),
      output: z.object({ rows: z.number(), plan: z.string() }),
    },
    {
      id: 'c',
      input: z.object({ plan: z.string() }),
      output: z.object({ asked: z.string() }),
    },
    {
      id: 'd',
      input: z.object({ rows: z.number() }),
      output: z.object({ done: z.boolean() }),
    },
  ];
  const edges: NonNullable<ContractWorkflow['edges']> = [
    { from: 'start', to: 'a', kind: 'next' },
    { from: 'a', to: 'b', kind: 'branch' },
    { from: 'a', to: 'c', kind: 'branch' },
    { from: 'b', to: 'd', kind: 'next' },
    { from: 'd', to: 'b', kind: 'loop' },
    { from: 'c', to: 'end', kind: 'next' },
    { from: 'd', to: 'end', kind: 'next' },
  ];

  it('lists the steps on every path to each step, closest first, loops left out', () => {
    expect(
      Object.fromEntries(stepsOnEveryPath(workflow(steps).steps, edges)),
    ).toEqual({ a: [], b: ['a'], c: ['a'], d: ['b', 'a'] });
  });

  it('gives a step its inputs from the steps on every path to it, not the list order', () => {
    // In list order, `c` sits between `b` and `d`, but no path runs b → c.
    expect(checkWorkflowContract({ ...workflow(steps), edges })).toEqual([]);
    const fromSideBranch = [
      ...steps.slice(0, 3),
      {
        id: 'd',
        input: z.object({ asked: z.string() }),
        output: z.object({ done: z.boolean() }),
      },
    ];
    // `asked` comes from `c`, which is not on the path a → b → d.
    expect(
      checkWorkflowContract({ ...workflow(fromSideBranch), edges }),
    ).toEqual([
      {
        stepId: 'd',
        field: 'asked',
        problem: 'missing',
        message: 'not given by the input or an earlier step',
      },
    ]);
    // Without edges the list order decides, and `c` (before `d`) gives it.
    expect(checkWorkflowContract(workflow(fromSideBranch))).toEqual([]);
  });
});

describe('checkWorkflowContract: checked when the catalogue loads (workflows R26)', () => {
  it.each(CODE_WORKFLOWS.map((source) => [source.id, source]))(
    'catalogued workflow %s keeps its contract',
    (_id, source) => {
      expect(checkWorkflowContract(source)).toEqual([]);
    },
  );

  it('missing: a required input that neither the input nor an earlier step gives', () => {
    const broken = workflow([
      {
        id: 'a',
        input: z.object({
          question: z.string(),
          datasets: z.array(z.string()),
        }),
        output: z.object({ x: z.string() }),
      },
      // `z` is only given by a later step.
      {
        id: 'b',
        input: z.object({ x: z.string(), z: z.string() }),
        output: z.object({}),
      },
      {
        id: 'c',
        input: z.object({ question: z.string() }),
        output: z.object({ z: z.string() }),
      },
    ]);
    expect(checkWorkflowContract(broken)).toEqual([
      {
        stepId: 'a',
        field: 'datasets',
        problem: 'missing',
        message: 'not given by the input or an earlier step',
      },
      {
        stepId: 'b',
        field: 'z',
        problem: 'missing',
        message: 'not given by the input or an earlier step',
      },
    ]);
  });

  it('an optional input nobody gives is no problem', () => {
    const fine = workflow([
      {
        id: 'a',
        input: z.object({ question: z.string(), note: z.string().optional() }),
        output: z.object({}),
      },
    ]);
    expect(checkWorkflowContract(fine)).toEqual([]);
  });

  it('type: a different JSON type, an array of another item type, a nested object property', () => {
    const broken = workflow([
      {
        id: 'a',
        input: z.object({ question: z.string() }),
        output: z.object({
          count: z.string(),
          tags: z.array(z.number()),
          rows: z.array(z.object({ n: z.string() })),
          maybe: z.string().nullable(),
        }),
      },
      {
        id: 'b',
        input: z.object({
          count: z.number(),
          tags: z.array(z.string()),
          rows: z.array(z.object({ n: z.number() })),
          maybe: z.string(),
        }),
        output: z.object({}),
      },
    ]);
    expect(checkWorkflowContract(broken)).toEqual([
      {
        stepId: 'b',
        field: 'count',
        problem: 'type',
        message: 'expected number, got string',
      },
      {
        stepId: 'b',
        field: 'tags[]',
        problem: 'type',
        message: 'expected string, got number',
      },
      {
        stepId: 'b',
        field: 'rows[].n',
        problem: 'type',
        message: 'expected number, got string',
      },
      {
        stepId: 'b',
        field: 'maybe',
        problem: 'type',
        message: 'expected string, got string | null',
      },
    ]);
  });

  it('optional: an optional output, or an optional input field without a default, feeding a required input', () => {
    const broken = workflow(
      [
        {
          id: 'a',
          input: z.object({ question: z.string(), limit: z.number() }),
          output: z.object({
            note: z.string().optional(),
            item: z.object({ id: z.string().optional() }),
          }),
        },
        {
          id: 'b',
          input: z.object({
            note: z.string(),
            item: z.object({ id: z.string() }),
          }),
          output: z.object({}),
        },
      ],
      [
        { name: 'question', label: 'Question', type: 'text', required: true },
        { name: 'limit', label: 'Limit', type: 'number', required: false },
      ],
    );
    expect(checkWorkflowContract(broken)).toEqual([
      {
        stepId: 'a',
        field: 'limit',
        problem: 'optional',
        message: 'may be missing',
      },
      {
        stepId: 'b',
        field: 'note',
        problem: 'optional',
        message: 'may be missing',
      },
      {
        stepId: 'b',
        field: 'item.id',
        problem: 'optional',
        message: 'may be missing',
      },
    ]);
  });

  it('maps input field types: text, textarea and dataset to string, number, boolean, datasets to string[]; a default or a boolean is always given', () => {
    const fine = workflow(
      [
        {
          id: 'a',
          input: z.object({
            t: z.string(),
            ta: z.string(),
            d: z.string(),
            n: z.number(),
            b: z.boolean(),
            ds: z.array(z.string()),
            withDefault: z.number(),
          }),
          output: z.object({}),
        },
      ],
      [
        { name: 't', label: 'T', type: 'text', required: true },
        { name: 'ta', label: 'TA', type: 'textarea', required: true },
        { name: 'd', label: 'D', type: 'dataset', required: true },
        { name: 'n', label: 'N', type: 'number', required: true },
        { name: 'b', label: 'B', type: 'boolean', required: false },
        { name: 'ds', label: 'DS', type: 'datasets', required: true },
        {
          name: 'withDefault',
          label: 'W',
          type: 'number',
          required: false,
          default: 3,
        },
      ],
    );
    expect(checkWorkflowContract(fine)).toEqual([]);
    const wrong = workflow(
      [
        {
          id: 'a',
          input: z.object({ ds: z.string() }),
          output: z.object({}),
        },
      ],
      [{ name: 'ds', label: 'DS', type: 'datasets', required: true }],
    );
    expect(checkWorkflowContract(wrong)).toEqual([
      {
        stepId: 'a',
        field: 'ds',
        problem: 'type',
        message: 'expected string, got string[]',
      },
    ]);
  });

  it('unknown accepts anything; the closest earlier output gives a field', () => {
    const fine = workflow([
      {
        id: 'a',
        input: z.object({ question: z.string() }),
        output: z.object({
          question: z.number(),
          anything: z.array(z.string()).nullable(),
        }),
      },
      {
        id: 'b',
        input: z.object({ question: z.number(), anything: z.unknown() }),
        output: z.object({}),
      },
    ]);
    expect(checkWorkflowContract(fine)).toEqual([]);
  });

  it('refuses a broken workflow when the catalogue is built, and passes a sound one through', () => {
    const broken = workflow([
      {
        id: 'a',
        input: z.object({
          question: z.number(),
          datasets: z.array(z.string()),
        }),
        output: z.object({}),
      },
    ]);
    expect(() => assertWorkflowContracts([broken])).toThrow(
      'Workflow "fixture" breaks its data contract: a.question expected number, got string; a.datasets not given by the input or an earlier step',
    );
    expect(assertWorkflowContracts(CODE_WORKFLOWS)).toBe(CODE_WORKFLOWS);
  });
});

describe('withContract: every step input and output validated at run time', () => {
  const schemas = {
    input: z.object({ question: z.string() }),
    output: z.object({
      calls: z.array(z.object({ tool: z.string(), rowCount: z.number() })),
    }),
  };

  it('passes a valid input and output through, parsed (unknown keys dropped)', async () => {
    const execute = jest.fn(({ inputData }: { inputData: unknown }) =>
      Promise.resolve({
        calls: [
          {
            tool: String((inputData as { question: string }).question),
            rowCount: 1,
          },
        ],
        extra: true,
      }),
    );
    const guarded = withContract('Analyse', schemas, execute);
    await expect(
      guarded({ inputData: { question: 'q', other: 1 } }),
    ).resolves.toEqual({ calls: [{ tool: 'q', rowCount: 1 }] });
    expect(execute).toHaveBeenCalledWith(
      expect.objectContaining({ inputData: { question: 'q' } }),
    );
  });

  it('refuses a bad input before the step runs, naming the step and the field', async () => {
    const execute = jest.fn(() => Promise.resolve({ calls: [] }));
    const guarded = withContract('Analyse', schemas, execute);
    const failure = guarded({ inputData: { question: 3 } });
    await expect(failure).rejects.toBeInstanceOf(ContractViolationError);
    await expect(failure).rejects.toThrow(
      'Contract violation in Analyse (input): question Invalid input: expected string, received number',
    );
    expect(execute).not.toHaveBeenCalled();
  });

  it('refuses a bad output with its nested path', async () => {
    const guarded = withContract('Analyse', schemas, () =>
      Promise.resolve({
        calls: [
          { tool: 'a', rowCount: 1 },
          { tool: 'b', rowCount: 2 },
          { tool: 'c', rowCount: 'many' },
        ],
      }),
    );
    await expect(guarded({ inputData: { question: 'q' } })).rejects.toThrow(
      'Contract violation in Analyse: calls[2].rowCount Invalid input: expected number, received string',
    );
  });

  it('checks a bailed value against the output schema too', async () => {
    const bail = jest.fn((value: unknown) => value);
    const ok = withContract(
      'Analyse',
      schemas,
      (params: { inputData: unknown; bail: (value: unknown) => unknown }) =>
        Promise.resolve(params.bail({ calls: [], extra: 1 })),
    );
    await expect(ok({ inputData: { question: 'q' }, bail })).resolves.toEqual({
      calls: [],
    });
    expect(bail).toHaveBeenCalledWith({ calls: [] });
    const bad = withContract(
      'Analyse',
      schemas,
      (params: { inputData: unknown; bail: (value: unknown) => unknown }) =>
        Promise.resolve(params.bail({ calls: 'none' })),
    );
    await expect(bad({ inputData: { question: 'q' }, bail })).rejects.toThrow(
      'Contract violation in Analyse: calls Invalid input: expected array, received string',
    );
  });

  it('names the path (root) when the whole value is wrong, so the path is always one word', async () => {
    const guarded = withContract('Analyse', schemas, () =>
      Promise.resolve('text'),
    );
    await expect(guarded({ inputData: { question: 'q' } })).rejects.toThrow(
      'Contract violation in Analyse: (root) Invalid input: expected object, received string',
    );
    const badInput = withContract('Wrap up', schemas, () =>
      Promise.resolve({ calls: [] }),
    );
    await expect(badInput({ inputData: undefined })).rejects.toThrow(
      'Contract violation in Wrap up (input): (root) Invalid input: expected object, received undefined',
    );
  });
});
