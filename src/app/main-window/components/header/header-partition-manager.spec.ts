import { HeaderComponent } from './header.component';

describe('Header custom partition menu', () => {
  let header: any;
  beforeEach(() => {
    header = Object.create(HeaderComponent.prototype);
    header.selectDebounceTimer = null;
    header.projectService = { currentProjectPath: 'D:\\Projects\\语音 project', getPackageJson: jasmine.createSpy('read'), setPackageJson: jasmine.createSpy('write') };
    header.uiService = { openWindow: jasmine.createSpy('openWindow'), openToolWindow: jasmine.createSpy('openToolWindow').and.returnValue(false) };
    header.closePortList = jasmine.createSpy('closeMenu');
    header.builderService = { triggerPreprocess: jasmine.createSpy('preprocess') };
  });

  it('opens a project-scoped independent window without selecting custom or choosing a file', async () => {
    await header.selectSubItem({ key: 'PartitionScheme', data: 'custom' });
    expect(header.uiService.openWindow).toHaveBeenCalledOnceWith(jasmine.objectContaining({
      path: 'partition-manager?project=' + encodeURIComponent(header.projectService.currentProjectPath), windowClass: 'builtin',
    }));
    expect(header.closePortList).toHaveBeenCalled();
    expect(header.projectService.setPackageJson).not.toHaveBeenCalled();
    expect(header.builderService.triggerPreprocess).not.toHaveBeenCalled();
  });

  it('prefers the replacement partition child application when installed', async () => {
    header.uiService.openToolWindow.and.returnValue(true);
    await header.selectSubItem({ key: 'PartitionScheme', data: 'custom' });
    expect(header.uiService.openToolWindow).toHaveBeenCalledOnceWith('ffs-manager-child', jasmine.objectContaining({ width: 920, height: 820 }));
    expect(header.uiService.openWindow).not.toHaveBeenCalled();
    expect(header.projectService.setPackageJson).not.toHaveBeenCalled();
  });

  it('does not open a disabled selection or a window without a project', async () => {
    await header.selectSubItem({ key: 'PartitionScheme', data: 'custom', disabled: true });
    header.projectService.currentProjectPath = '';
    await header.selectSubItem({ key: 'PartitionScheme', data: 'custom' });
    expect(header.uiService.openWindow).not.toHaveBeenCalled();
  });
});
