import { handleJsonRequest } from './json-worker-handler';

describe('handleJsonRequest', () => {
  it('compares two texts and returns the diff without values', () => {
    const reply = handleJsonRequest({
      op: 'diff',
      left: '{"a":1,"at":1,"big":12345678901234567890}',
      right: '{"a":2,"at":2,"big":12345678901234567891}',
      matchArrays: true,
      ignoreText: '$.at',
    });
    expect(reply).toEqual({
      op: 'diff',
      ignoreError: null,
      result: expect.objectContaining({
        changed: 2,
        changes: [
          { path: '$.a', kind: 'chg' },
          { path: '$.big', kind: 'chg' },
        ],
      }),
    });
    expect(structuredClone(reply)).toEqual(reply);
  });

  it('validates a document against a schema', () => {
    expect(handleJsonRequest({ op: 'validate', doc: '"x"', schema: '{"type":"number"}' })).toEqual({
      op: 'validate',
      result: expect.objectContaining({ errors: [expect.objectContaining({ path: '$' })] }),
    });
    expect(handleJsonRequest({ op: 'validate', doc: '1', schema: '{"$ref":"#/nope"}' })).toEqual({
      op: 'validate',
      schemaError: expect.stringMatching(/^Reference/),
    });
  });

  it('reports text that cannot be parsed as an error', () => {
    const reply = handleJsonRequest({ op: 'validate', doc: '{', schema: '{}' });
    expect(reply.op).toBe('error');
  });
});
