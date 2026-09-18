import { searchBoardsLibrariesTool } from '../board-library-search';

describe('board/library discovery budgets', () => {
  const config = { libraryList: Array.from({ length: 17 }, (_, i) => ({ name: `lib-sensor-${i}`, nickname: `Sensor ${i}`, description: 'sensor' })) } as any;
  it('returns a small default with true total and explicit truncation', async () => {
    const result = await searchBoardsLibrariesTool.handler({ query: 'sensor', type: 'libraries' }, config);
    expect(result.is_error).toBeFalse();
    expect(result.metadata).toEqual(jasmine.objectContaining({ totalMatches: 17, returnedCount: 10, truncated: true }));
    expect(result.metadata!.results!.length).toBe(10);
    const complete = await searchBoardsLibrariesTool.handler({ query: 'sensor', type: 'libraries', maxResults: 50 }, config);
    expect(complete.metadata).toEqual(jasmine.objectContaining({ totalMatches: 17, returnedCount: 17, truncated: false }));
  });
  it('rejects invalid budgets instead of interpreting negative slice indices', async () => {
    for (const maxResults of [0, -1, 51, 1.5, NaN]) {
      expect((await searchBoardsLibrariesTool.handler({ query: 'sensor', maxResults }, config)).is_error).toBeTrue();
    }
  });
  it('reports an empty catalog without a second metadata query', async () => {
    const result = await searchBoardsLibrariesTool.handler({ query: 'absent', type: 'libraries' }, config);
    expect(result.metadata).toEqual(jasmine.objectContaining({ totalMatches: 0, returnedCount: 0, truncated: false, results: [] }));
  });
});
