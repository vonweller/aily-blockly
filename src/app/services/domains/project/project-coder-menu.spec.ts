import { BehaviorSubject, Subject } from 'rxjs';
import { ProjectService } from './project.service';

describe('Coder board menu context ownership', () => {
  let project: any, originalPath: any, originalBoard: any;
  beforeEach(() => {
    originalPath = window['path']; originalBoard = window['boardConfig'];
    window['path'] = { join: (...parts: string[]) => parts.join('/') };
    project = Object.create(ProjectService.prototype);
    Object.assign(project, {
      currentProjectPathSubject: new BehaviorSubject('/a'), stateSubject: new BehaviorSubject('loaded'),
      coderProjectContexts: new Map(), boardConfigUpdatedSubject: new Subject(),
      getProjectMode: () => 'coder', currentBoardMenuConfig: [{ key: 'old-blockly-menu' }], currentBoardMenuI18nDir: '/old',
      electronService: { readFile: () => '{"type":"coder"}', pathJoin: (...parts: string[]) => parts.join('/'),
        exists: (path: string) => path.endsWith('menu.json') },
      translate: { currentLang: 'zh-CN', instant: (key: string) => key },
    });
    project.electronService.readFile = (path: string) => path.endsWith('menu.json')
      ? JSON.stringify([{ key: path.startsWith('/a/') ? 'CDCOnBoot' : 'pnum', children: [{ data: 'default' }] }])
      : '{"type":"coder"}';
    Object.defineProperty(project, 'dependencyLifecycle', { value: {} });
  });
  afterEach(() => { window['path'] = originalPath; window['boardConfig'] = originalBoard; });

  function context(path: string) {
    const service = project.getCoderProjectContext(path);
    service.getBoardPackagePath = async () => `${path}/node_modules/board`;
    service.resolveBoardConfigForRuntime = async () => ({ type: path, _cdcEnabled: path === '/a' });
    service.getPackageJson = async () => ({ projectConfig: {} });
    service.getBoardDependencies = async () => ({});
    return service;
  }
  it('loads each board menu with its resolved runtime config and does not inherit the previous editor menu', async () => {
    const a = context('/a'), b = context('/b');
    expect(a.currentBoardMenuConfig).toEqual([]);
    expect(b.currentBoardMenuConfig).toEqual([]);
    expect(await a.syncCurrentBoardConfig()).toBeTrue();
    expect(project.currentBoardMenuConfig[0].key).toBe('CDCOnBoot');
    expect(project.currentBoardConfig._cdcEnabled).toBeTrue();
    expect(await b.syncCurrentBoardConfig()).toBeTrue();
    expect(project.currentBoardConfig.type).toBe('/a');
    expect(window['boardConfig'].type).toBe('/a');
    project.currentProjectPathSubject.next('/b');
    project.publishCoderProjectContext(b);
    expect(project.currentBoardMenuConfig[0].key).toBe('pnum');
    expect(project.currentBoardMenuI18nDir).toBe('/b/node_modules/board/i18n');
    expect((await b.getBoardConfigMenu())[0].key).toBe('pnum');
  });
  it('keeps menu inspection read-only even for first-option pin defaults', async () => {
    const a = context('/a');
    a.currentBoardMenuConfig = [{ key: 'pnum', extra: { selectFirstByDefault: true, syncPinConfig: true }, children: [{ data: 'first', extra: { build: { variant: 'first' } } }] }];
    a.setPackageJson = jasmine.createSpy('persist');
    a.syncBoardPinConfig = jasmine.createSpy('pins');
    const menu = await a.getBoardConfigMenu();
    expect(menu[0].children[0].check).toBeTrue();
    expect(a.setPackageJson).not.toHaveBeenCalled();
    expect(a.syncBoardPinConfig).not.toHaveBeenCalled();
  });
  it('clears stale options when a board disappears and recovers when dependencies become available', async () => {
    const a = context('/a');
    await a.syncCurrentBoardConfig();
    a.resolveBoardConfigForRuntime = async () => { throw new Error('board not installed'); };
    expect(await a.syncCurrentBoardConfig()).toBeFalse();
    expect(project.currentBoardConfig).toBeNull();
    expect(project.currentBoardMenuConfig).toEqual([]);
    a.resolveBoardConfigForRuntime = async () => ({ type: 'restored' });
    expect(await a.syncCurrentBoardConfig()).toBeTrue();
    expect(project.currentBoardMenuConfig[0].key).toBe('CDCOnBoot');
  });
});
