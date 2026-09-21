import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { ElectronService, PlatformService } from '@core/platform/public-api';
import { NzModalService } from 'ng-zorro-antd/modal';
import { PartitionManagerComponent } from './partition-manager.component';
import { allocatePartitions, createPreset, MIB, serializePartitions } from './partition-layout';

describe('Partition manager window interactions', () => {
  let fixture: ComponentFixture<PartitionManagerComponent>;
  let component: PartitionManagerComponent;
  let originalWindow: any;
  let bridge: any;
  let modal: any;
  const text = () => fixture.nativeElement.textContent as string;
  const button = (label: string): HTMLButtonElement => Array.from(fixture.nativeElement.querySelectorAll('button') as NodeListOf<HTMLButtonElement>)
    .find(item => item.textContent!.trim() === label)!;

  beforeEach(async () => {
    originalWindow = window['iWindow'];
    bridge = { close: jasmine.createSpy('close'), send: jasmine.createSpy('send').and.resolveTo({ success: true, context: {
      token: 'session', projectPath: '/project', projectName: 'Test project', boardName: 'ESP32-S3',
      flashBytes: 8 * MIB, flashOptions: [{ value: '8M', bytes: 8 * MIB }],
      csv: '', source: 'missing', customSelected: false, draft: null, xiaozhiSupported: false,
    } }) };
    window['iWindow'] = bridge;
    modal = { confirm: jasmine.createSpy('confirm') };
    await TestBed.configureTestingModule({
      imports: [PartitionManagerComponent],
      providers: [provideRouter([]), provideNoopAnimations(),
        { provide: ActivatedRoute, useValue: { snapshot: { queryParamMap: convertToParamMap({ project: '/project' }) } } },
        { provide: ElectronService, useValue: { isElectron: false, isWindowFullScreen: () => false } },
        { provide: PlatformService, useValue: { isMac: () => false } },
        { provide: NzModalService, useValue: modal },
      ],
    }).overrideProvider(NzModalService, { useValue: modal }).compileComponents();
    fixture = TestBed.createComponent(PartitionManagerComponent);
    component = fixture.componentInstance;
    fixture.detectChanges(); await fixture.whenStable(); fixture.detectChanges();
  });
  afterEach(() => { fixture.destroy(); window['iWindow'] = originalWindow; });

  it('opens with recommended controls, an OTA layout, and no writes', () => {
    expect(text()).toContain('物联网应用'); expect(text()).toContain('单份程序上限');
    expect(component.layout.ota).toBeTrue(); expect(component.dirty).toBeFalse();
    expect(fixture.nativeElement.querySelector('table')).toBeNull();
    expect(bridge.send).toHaveBeenCalledTimes(1);
    expect(bridge.send.calls.first().args[0].data.action).toBe('partition-manager-load');
  });

  it('preserves manually assigned program size when OTA changes and supports undo', async () => {
    button('调整空间').click(); fixture.detectChanges();
    const input: HTMLInputElement = fixture.nativeElement.querySelector('#app-size');
    input.value = '2.5'; input.dispatchEvent(new Event('change')); fixture.detectChanges();
    const ota: HTMLInputElement = fixture.nativeElement.querySelector('.feature input');
    ota.click(); await fixture.whenStable(); fixture.detectChanges();
    expect(component.layout.ota).toBeFalse(); expect(component.layout.appLimit).toBe(2.5 * MIB);
    button('撤销上一步').click(); fixture.detectChanges();
    expect(component.layout.ota).toBeTrue(); expect(component.layout.appLimit).toBe(2.5 * MIB);
  });

  it('blocks overflow, offers valid repairs, and retains the last valid map', () => {
    const previous = component.segments;
    component.setSize('appBytes', '5'); fixture.detectChanges();
    expect(button('保存分区方案').disabled).toBeTrue(); expect(text()).toContain('空间不足');
    expect(component.segments).toBe(previous); expect(component.repairs.length).toBeGreaterThan(0);
    component.applyRepair(component.repairs[0]); fixture.detectChanges();
    expect(component.errors).toEqual([]); expect(button('保存分区方案').disabled).toBeFalse();
  });

  it('keeps an imported CSV unchanged and requires explicit discard before closing', async () => {
    const raw = '\uFEFF# custom comment\r\n' + serializePartitions(allocatePartitions(createPreset('iot', 8 * MIB)).rows);
    await component.importCsv({ target: { files: [{ size: raw.length, text: async () => raw }], value: 'file.csv' } } as any);
    fixture.detectChanges(); expect(component.state.csv).toBe(raw); expect(component.draft).toBeNull();
    const pending = component.close(); expect(bridge.close).not.toHaveBeenCalled();
    modal.confirm.calls.mostRecent().args[0].nzOnCancel(); await pending;
    expect(bridge.close).not.toHaveBeenCalled(); expect(component.state.csv).toBe(raw);
  });

  it('shows XiaoZhi as a reference when the project lacks a matching layout', () => {
    component.selectPreset('xiaozhi'); fixture.detectChanges();
    expect(text()).toContain('当前仅预览'); expect(component.canSave).toBeFalse();
    component.undo(); expect(component.canSave).toBeTrue();
  });

  it('keeps the window and draft on save failure, then closes after a successful retry', async () => {
    component.setSize('appBytes', '2.5'); const csv = component.state.csv;
    bridge.send.and.resolveTo({ success: false, error: 'external change' });
    await component.save(); fixture.detectChanges();
    expect(text()).toContain('external change'); expect(component.state.csv).toBe(csv);
    expect(bridge.close).not.toHaveBeenCalled(); expect(component.saving).toBeFalse();
    bridge.send.and.resolveTo({ success: true }); await component.save();
    expect(bridge.close).toHaveBeenCalledTimes(1); expect(component.allowClose).toBeTrue();
    expect(bridge.send.calls.mostRecent().args[0].data.csv).toBe(csv);
  });
});
