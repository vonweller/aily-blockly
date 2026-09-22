import { AuthService, normalizeAuthCreditSnapshot, normalizeAuthQuotaInfoSnapshotPayload,
  resolveAuthQuotaInfoSnapshotOverride, type AuthSnapshot } from '@core/auth/public-api';
import { buildChildAuthStateSnapshot } from '../child-tool-host/child-auth-state';
import { formatCreditQuota, isProCreditPlan } from './credit-display';
import { TestBed, ComponentFixture } from '@angular/core/testing';
import { BehaviorSubject, of } from 'rxjs';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { NzMessageService } from 'ng-zorro-antd/message';
import { ElectronService } from '@core/platform/public-api';
import { UiService } from '@core/app-shell/public-api';
import { ToolI18nService } from '@core/preferences/public-api';
import { ChildAppSafetyService } from '@integration/subapps/public-api';
import { UserCenterComponent } from './user-center.component';
import { API } from '../../configs/api.config';

const payload = {
  unit: 'credits',
  available_micros: 29_993_290,
  reserved_micros: 0,
  included_granted_micros: 30_000_000,
  subscription_plan: 'free',
  next_reset_at: '2026-09-15T00:00:00Z',
};

// Public /api/v1/credits/me response, rather than the legacy quota-info route.
const ledgerPayload = {
  balance_micros: 29_993_290,
  reserved_micros: 0,
  overage_enabled: false,
  overage_limit_micros: 0,
  overage_used_micros: 0,
  spending_cap_micros: 0,
  grace_per_call_micros: 0,
  uncovered_micros: 0,
  available_micros: 29_993_290,
  included_granted_micros: 30_000_000,
  included_remaining_micros: 29_993_290,
  included_used_micros: 6_710,
  included_percent_used: 0.022366666666666666,
  next_reset_at: payload.next_reset_at,
  subscription_plan: 'free',
};

describe('Credit quota contract', () => {
  it('preserves integer micros and the server reset time', () => {
    const snapshot = normalizeAuthQuotaInfoSnapshotPayload(payload, { source: 'token' });
    expect(snapshot?.source).toBe('token');
    expect(snapshot?.creditSnapshot?.available_micros).toBe(29_993_290);
    expect(snapshot?.creditSnapshot?.next_reset_at).toBe(payload.next_reset_at);
    expect(snapshot?.quotaSnapshots).toBeUndefined();
  });

  it('accepts the public ledger response without a synthetic unit field', () => {
    const snapshot = normalizeAuthQuotaInfoSnapshotPayload(ledgerPayload, { source: 'token' });
    expect(snapshot?.creditSnapshot).toEqual(normalizeAuthCreditSnapshot(payload));
    expect(snapshot?.quotaSnapshots).toBeUndefined();
  });

  it('allows absent optional ledger fields without inventing values', () => {
    expect(normalizeAuthCreditSnapshot({ available_micros: 1, reserved_micros: 0 })).toEqual({
      available_micros: 1, reserved_micros: 0,
      included_granted_micros: null, next_reset_at: null, subscription_plan: null,
    });
  });

  it('rejects an explicit non-Credit unit even when micros are present', () => {
    expect(normalizeAuthCreditSnapshot({ ...ledgerPayload, unit: 'interactions' })).toBeUndefined();
  });

  for (const response of [ledgerPayload, { status: 200, data: ledgerPayload }]) {
    it('loads Credit balances from the ledger route with the current credential', async () => {
      const service = Object.create(AuthService.prototype) as any;
      service.http = { get: jasmine.createSpy().and.returnValue(of(response)) };
      service.authQuotaRequestTimeoutMs = 8000;
      const snapshot = await service.getAuthQuotaInfoSnapshot('test-current-account-token');
      expect(service.http.get).toHaveBeenCalledOnceWith(API.authCreditSnapshot, {
        headers: { Authorization: 'Bearer test-current-account-token' },
      });
      expect(API.authCreditSnapshot).toMatch(/\/api\/v1\/credits\/me$/);
      expect(snapshot).toEqual({ source: 'token', creditSnapshot: normalizeAuthCreditSnapshot(payload) });
    });
  }

  it('rejects legacy counters returned from the ledger route', async () => {
    const service = Object.create(AuthService.prototype) as any;
    service.http = { get: () => of({ status: 200, data: {
      quota_snapshots: { premium_interactions: { entitlement: 30, remaining: 22, percent_remaining: 73.33 } },
    } }) };
    service.authQuotaRequestTimeoutMs = 8000;
    await expectAsync(service.getAuthQuotaInfoSnapshot('test-current-account-token'))
      .toBeRejectedWithError('Invalid Credit quota snapshot');
  });

  it('does not relabel an old count snapshot as Credits', () => {
    expect(normalizeAuthCreditSnapshot({
      quota_snapshots: { premium_interactions: { entitlement: 30, remaining: 22, percent_remaining: 73.33 } },
    })).toBeUndefined();
  });

  for (const [field, value] of [
    ['available_micros', -1], ['available_micros', 1.5], ['available_micros', NaN],
    ['available_micros', '29993290'], ['available_micros', Number.MAX_SAFE_INTEGER + 1],
    ['reserved_micros', undefined], ['included_granted_micros', '30'],
    ['next_reset_at', 'invalid'], ['subscription_plan', {}],
  ]) {
    it(`rejects invalid ${field}: ${String(value)}`, () => {
      expect(normalizeAuthCreditSnapshot({ ...payload, [field as string]: value })).toBeUndefined();
    });
  }

  it('never falls back to legacy fields in an invalid Credit response', () => {
    expect(normalizeAuthQuotaInfoSnapshotPayload({
      ...payload, available_micros: 'bad',
      quota_snapshots: { premium_interactions: { entitlement: 30, remaining: 22, percent_remaining: 73.33 } },
    })).toBeUndefined();
  });

  it('never falls back to legacy fields in an invalid unmarked ledger response', () => {
    expect(normalizeAuthQuotaInfoSnapshotPayload({
      ...ledgerPayload, available_micros: 'bad',
      quota_snapshots: { premium_interactions: { entitlement: 30, remaining: 22, percent_remaining: 73.33 } },
    })).toBeUndefined();
  });

  it('shows the Free balance with micros precision', () => {
    expect(formatCreditQuota(normalizeAuthCreditSnapshot(payload)!, 'en-US')).toBe('29.99329/30 Credit');
    expect(formatCreditQuota(normalizeAuthCreditSnapshot({ ...payload, available_micros: 1 })!, 'en-US'))
      .toBe('0.000001/30 Credit');
    expect(formatCreditQuota(normalizeAuthCreditSnapshot({ ...payload, available_micros: 0 })!, 'en-US'))
      .toBe('0/30 Credit');
  });

  it('uses available balance without subtracting the hold a second time', () => {
    expect(formatCreditQuota(normalizeAuthCreditSnapshot({ ...payload, reserved_micros: 1_000_000 })!, 'en-US'))
      .toBe('29.99329/30 Credit');
  });

  it('shows Pro infinity only as a display policy', () => {
    const snapshot = normalizeAuthCreditSnapshot({ ...payload, subscription_plan: 'pro', included_granted_micros: 300_000_000 })!;
    expect(formatCreditQuota(snapshot, 'en-US')).toBe('\u267e\ufe0f');
    expect(snapshot.available_micros).toBe(29_993_290);
    expect(snapshot.included_granted_micros).toBe(300_000_000);
  });

  it('recognizes subscription plans, not names that happen to contain pro', () => {
    expect(isProCreditPlan('pro_plus')).toBeTrue();
    expect(isProCreditPlan('PRO')).toBeTrue();
    expect(isProCreditPlan('free')).toBeFalse();
    expect(isProCreditPlan('prototype')).toBeFalse();
    expect(isProCreditPlan(null)).toBeFalse();
  });

  it('shows no fabricated quota when a snapshot is unavailable', () => {
    expect(formatCreditQuota(null, 'en-US')).toBe('--');
    expect(formatCreditQuota(null, 'en-US', 'free')).toBe('--');
  });

  it('shows confirmed Pro membership without requiring a Credit balance', () => {
    expect(formatCreditQuota(null, 'en-US', 'pro')).toBe('\u267e\ufe0f');
    expect(formatCreditQuota(null, 'en-US', 'pro_plus')).toBe('\u267e\ufe0f');
  });

  it('prefers the current ledger plan over a stale profile plan', () => {
    expect(formatCreditQuota(normalizeAuthCreditSnapshot(payload)!, 'en-US', 'pro'))
      .toBe('29.99329/30 Credit');
  });

  it('does not invent a denominator or reset time for a missing included bucket', () => {
    const snapshot = normalizeAuthCreditSnapshot({ ...payload, included_granted_micros: null, next_reset_at: null })!;
    expect(formatCreditQuota(snapshot, 'en-US')).toBe('29.99329 Credit');
    expect(snapshot.next_reset_at).toBeNull();
  });

  it('keeps the last same-account snapshot on a failed refresh, never across logout or accounts', () => {
    const snapshot = normalizeAuthQuotaInfoSnapshotPayload(payload)!;
    expect(resolveAuthQuotaInfoSnapshotOverride(snapshot, null, { id: 'a' }, { id: 'a' })).toBe(snapshot);
    expect(resolveAuthQuotaInfoSnapshotOverride(snapshot, null, { id: 'b' }, { id: 'a' })).toBeNull();
    expect(resolveAuthQuotaInfoSnapshotOverride(snapshot, undefined, { id: 'b' }, { id: 'a' })).toBeNull();
    expect(resolveAuthQuotaInfoSnapshotOverride(snapshot, undefined, null, { id: 'a' })).toBeNull();
  });

  it('does not broadcast stale count quotas to Lex once a Credit snapshot is loaded', () => {
    const child = buildChildAuthStateSnapshot(true, { id: 'a' }, {
      quotaInfoSnapshot: normalizeAuthQuotaInfoSnapshotPayload(payload),
      quotaSummary: { totalToken: 30, usedToken: 8, remainingToken: 22 },
    });
    expect(child.authenticated).toBeTrue();
    expect(child.user?.id).toBe('a');
    expect(child.quotaSnapshot).toBeUndefined();
  });
});

describe('User center Credit rendering', () => {
  let fixture: ComponentFixture<UserCenterComponent>;
  let snapshots: BehaviorSubject<AuthSnapshot | null>;
  let users: BehaviorSubject<any>;
  let auth: { isLoggedIn: boolean; refreshMe: jasmine.Spy };

  beforeEach(async () => {
    snapshots = new BehaviorSubject<AuthSnapshot | null>({
      quotaInfoSnapshot: normalizeAuthQuotaInfoSnapshotPayload(payload),
    });
    auth = { isLoggedIn: true, refreshMe: jasmine.createSpy().and.resolveTo() };
    users = new BehaviorSubject({ subscription_plan: { name: 'free', service_tier: 'pro' } });
    await TestBed.configureTestingModule({
      imports: [UserCenterComponent, TranslateModule.forRoot()],
      providers: [
        { provide: AuthService, useValue: {
          ...auth, authSnapshot$: snapshots, isLoggedIn$: new BehaviorSubject(true),
          userInfo$: users,
          checkAndSyncAuthStatus: () => Promise.resolve(),
          getBenefits: () => of({ status: 200, data: {
            ai_calls: { total: 30, used: 8, resetDate: '2026-10-01T00:00:00Z' },
          } }),
        } },
        { provide: ElectronService, useValue: {} },
        { provide: UiService, useValue: {} },
        { provide: ChildAppSafetyService, useValue: {} },
        { provide: NzMessageService, useValue: {} },
        { provide: ToolI18nService, useValue: { load: () => Promise.resolve() } },
      ],
    }).compileComponents();
    TestBed.inject(TranslateService).use('en');
    fixture = TestBed.createComponent(UserCenterComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  });

  it('renders the Credit snapshot instead of legacy benefits or service tier', () => {
    expect(fixture.nativeElement.querySelector('.user-data .value').textContent).toContain('29.99329/30 Credit');
    expect(fixture.nativeElement.textContent).not.toContain('22/30');
    expect(fixture.componentInstance.isProPlanSubscriber).toBeFalse();
    expect(fixture.componentInstance.displayCreditResetDate).toContain('09/15');
  });

  it('updates the existing panel after a new snapshot and shows Pro infinity', () => {
    snapshots.next({ quotaInfoSnapshot: normalizeAuthQuotaInfoSnapshotPayload({ ...payload, subscription_plan: 'pro' }) });
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.user-data .value').textContent).toContain('\u267e\ufe0f');
  });

  it('clears the balance on logout without displaying legacy benefits', () => {
    snapshots.next(null);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.user-data .value').textContent.trim()).toBe('--');
    expect(fixture.componentInstance.displayCreditResetDate).toBe('');
  });

  it('shows Pro infinity when the Credit snapshot is unavailable', () => {
    snapshots.next(null);
    users.next({ subscription_plan: { name: 'pro' } });
    fixture.detectChanges();
    expect(fixture.componentInstance.isProPlanSubscriber).toBeTrue();
    expect(fixture.nativeElement.querySelector('.user-data .value').textContent).toContain('\u267e\ufe0f');
    expect(fixture.componentInstance.displayCreditResetDate).toBe('');
  });

  it('does not infer infinity from a service tier or an old unlimited count', () => {
    snapshots.next(null);
    users.next({ subscription_plan: { name: 'free', service_tier: 'pro' }, quota: { total_token: -1 } });
    fixture.detectChanges();
    expect(fixture.componentInstance.isProPlanSubscriber).toBeFalse();
    expect(fixture.nativeElement.querySelector('.user-data .value').textContent.trim()).toBe('--');
  });

  it('clears Pro infinity on logout even before the user stream is cleared', () => {
    snapshots.next(null);
    users.next({ subscription_plan: { name: 'pro' } });
    Object.defineProperty(TestBed.inject(AuthService), 'isLoggedIn', { value: false });
    fixture.detectChanges();
    expect(fixture.componentInstance.isProPlanSubscriber).toBeFalse();
    expect(fixture.nativeElement.querySelector('.user-data .value').textContent.trim()).toBe('--');
  });

  it('refreshes on focus and coalesces concurrent refreshes', async () => {
    let release!: () => void;
    auth.refreshMe.calls.reset();
    auth.refreshMe.and.returnValue(new Promise<void>(resolve => { release = resolve; }));
    fixture.componentInstance.onWindowFocus();
    fixture.componentInstance.onWindowFocus();
    expect(auth.refreshMe).toHaveBeenCalledTimes(1);
    release();
    await fixture.whenStable();
  });

  for (const width of [360, 720]) {
    it(`keeps the Credit value inside the panel at ${width}px`, () => {
      fixture.nativeElement.style.display = 'block';
      fixture.nativeElement.style.width = `${width}px`;
      fixture.detectChanges();
      const panel = fixture.nativeElement.getBoundingClientRect();
      const value = fixture.nativeElement.querySelector('.user-data .value').getBoundingClientRect();
      expect(value.right).toBeLessThanOrEqual(panel.right + 1);
      expect(value.left).toBeGreaterThanOrEqual(panel.left);
    });
  }
});
