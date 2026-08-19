import { BehaviorSubject } from 'rxjs';
import {
  RequiredSubappService,
  resolveRequiredSubappState,
} from './required-subapp.service';
import type {
  SubappCatalogState,
  SubappInstallProgress,
} from './subapp-manager.service';

const emptyCatalog = (): SubappCatalogState => ({
  loading: false,
  source: 'network',
  indexUrl: 'https://example.test/subapp-index.json',
  installRoot: '/tmp/subapps',
  apps: [],
});

const coderEntry = (installed: boolean) => ({
  id: 'aily-coder',
  toolId: 'aily-coder',
  packageName: '@aily-project/subapp-aily-coder',
  availableVersion: '0.1.0',
  installedVersion: installed ? '0.1.0' : null,
  installed,
  updateAvailable: false,
  titleKey: 'AILY_CODER.TITLE',
  namespace: 'AILY_CODER',
  name: 'Aily Coder',
  description: 'Coder extension',
  icon: 'fa-light fa-code',
  enabled: true,
  config: installed ? ({ id: 'aily-coder' } as any) : null,
});

describe('RequiredSubappService', () => {
  it('projects real install progress for one required catalog item', () => {
    const catalog = emptyCatalog();
    catalog.apps = [coderEntry(false)];
    const progress: SubappInstallProgress = {
      id: 'aily-coder',
      action: 'install',
      phase: 'download',
      percent: 47,
    };

    expect(resolveRequiredSubappState('aily-coder', catalog, progress)).toEqual(jasmine.objectContaining({
      status: 'installing',
      installing: true,
      percent: 47,
    }));
  });

  it('distinguishes an unavailable catalog item from an installed one', () => {
    expect(resolveRequiredSubappState('aily-coder', emptyCatalog(), null).status).toBe('unavailable');

    const catalog = emptyCatalog();
    catalog.apps = [coderEntry(true)];
    expect(resolveRequiredSubappState('aily-coder', catalog, null)).toEqual(jasmine.objectContaining({
      status: 'installed',
      installed: true,
      percent: 100,
    }));
  });

  it('reports installed immediately when the catalog updates before completed progress clears', () => {
    const catalog = emptyCatalog();
    catalog.apps = [coderEntry(true)];
    const progress: SubappInstallProgress = {
      id: 'aily-coder',
      action: 'install',
      phase: 'complete',
      percent: 100,
    };

    expect(resolveRequiredSubappState('aily-coder', catalog, progress)).toEqual(jasmine.objectContaining({
      status: 'installed',
      installed: true,
      installing: false,
      percent: 100,
    }));
  });

  it('deduplicates concurrent installations and reports whether this call installed the package', async () => {
    const stateSubject = new BehaviorSubject<SubappCatalogState>({
      ...emptyCatalog(),
      apps: [coderEntry(false)],
    });
    const progressSubject = new BehaviorSubject<SubappInstallProgress | null>(null);
    let installCount = 0;
    let resolveInstall!: () => void;
    const installGate = new Promise<void>((resolve) => { resolveInstall = resolve; });
    const manager = {
      state$: stateSubject.asObservable(),
      progress$: progressSubject.asObservable(),
      get state() { return stateSubject.value; },
      initialize: async () => undefined,
      install: async () => {
        installCount += 1;
        await installGate;
        stateSubject.next({ ...stateSubject.value, apps: [coderEntry(true)] });
      },
    };
    const service = new RequiredSubappService(manager as any);

    const first = service.ensureInstalled('aily-coder');
    const second = service.ensureInstalled('aily-coder');
    resolveInstall();

    await expectAsync(first).toBeResolvedTo({ installedNow: true });
    await expectAsync(second).toBeResolvedTo({ installedNow: true });
    expect(installCount).toBe(1);
    await expectAsync(service.ensureInstalled('aily-coder')).toBeResolvedTo({ installedNow: false });
  });
});
