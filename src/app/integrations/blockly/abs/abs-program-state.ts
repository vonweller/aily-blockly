import { absJson } from './abs-json';

/** ABS concurrency excludes only the viewport's three known presentation values.
 * Block positions, page ownership, unknown extension state and disk bytes remain
 * significant. This does not change projection hashes or persistence revisions. */
export function absProgramDocument(document: unknown): unknown {
  if (!document || typeof document !== 'object' || !Array.isArray(document['pages'])) return document;
  return { ...document, pages: document['pages'].map(page => {
    if (!page?.viewState || typeof page.viewState !== 'object' || Array.isArray(page.viewState)) return page;
    const viewState = { ...page.viewState };
    for (const key of ['scale', 'scrollX', 'scrollY']) {
      if (typeof viewState[key] === 'number' && Number.isFinite(viewState[key])) delete viewState[key];
    }
    const { viewState: ignored, ...rest } = page;
    return Object.keys(viewState).length ? { ...rest, viewState } : rest;
  }) };
}

export function sameAbsProgram(a: unknown, b: unknown): boolean {
  return absJson(absProgramDocument(a)) === absJson(absProgramDocument(b));
}
