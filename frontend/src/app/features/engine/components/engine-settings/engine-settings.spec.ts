import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { API_BASE_URL } from '../../../../core/config/api.config';
import { EngineOptions, EngineSettingsView } from '../../models/engine.model';
import { EngineSettings } from './engine-settings';

const settingsUrl = `${API_BASE_URL}/engine/settings`;

const PRODUCTION_DEFAULTS: EngineOptions = {
  careful: 'off',
  answerReview: false,
  sqlRepair: true,
  repairIntentGuard: true,
  context: 'curated',
  columnProfiles: false,
  inlineKnowledge: false,
  rankedKnowledge: false,
  lookupTools: false,
  sqlPrecheck: false,
  descriptiveErrors: false,
  extendedGuards: false,
  staticFirstContext: false,
  promptAblation: [],
  memory: 'off',
};

function view(overrides: Partial<EngineSettingsView> = {}): EngineSettingsView {
  return {
    defaults: { ...PRODUCTION_DEFAULTS },
    stored: {},
    productionDefaults: { ...PRODUCTION_DEFAULTS },
    judgeModel: null,
    databricksReasoningEffort: false,
    arms: { baseline: {}, 'fixer-off': { sqlRepair: false } },
    armDescriptions: {
      baseline: 'Production defaults as saved in Settings → Engine levers',
      'fixer-off': 'SQL fixer off, descriptive errors on',
    },
    ruleGroups: [
      { id: 'role', title: 'Role', ablatable: false },
      { id: 'visuals', title: 'Visuals', ablatable: true },
      { id: 'rationale', title: 'Rationale', ablatable: true },
    ],
    ...overrides,
  };
}

describe('EngineSettings', () => {
  let fixture: ComponentFixture<EngineSettings>;
  let component: EngineSettings;
  let http: HttpTestingController;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [EngineSettings],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    }).compileComponents();
    fixture = TestBed.createComponent(EngineSettings);
    component = fixture.componentInstance;
    http = TestBed.inject(HttpTestingController);
    fixture.detectChanges();
    http.expectOne(settingsUrl).flush(view());
  });

  afterEach(() => http.verify());

  it('loads the resolved defaults as the working copy', () => {
    expect(component.options()).toEqual(PRODUCTION_DEFAULTS);
    expect(component.loading()).toBeFalse();
  });

  it('omits `defaults` from the save payload when no lever was touched', () => {
    component.judgeModel.set('openai/gpt-4.1-mini');
    component.save();

    const req = http.expectOne(settingsUrl);
    expect(req.request.method).toBe('PUT');
    expect(req.request.body).toEqual({
      judgeModel: 'openai/gpt-4.1-mini',
      databricksReasoningEffort: false,
    });
    req.flush({ ok: true, message: 'Engine settings saved' });
  });

  it('sends the full working options as `defaults` once a lever changes', () => {
    component.setBoolean('columnProfiles', true);
    component.save();

    const req = http.expectOne(settingsUrl);
    expect(req.request.body).toEqual({
      judgeModel: null,
      databricksReasoningEffort: false,
      defaults: { ...PRODUCTION_DEFAULTS, columnProfiles: true },
    });
    req.flush({ ok: true, message: 'Engine settings saved' });
  });

  it('sends judgeModel: null when a previously-set judge model is cleared', () => {
    fixture = TestBed.createComponent(EngineSettings);
    component = fixture.componentInstance;
    fixture.detectChanges();
    http
      .expectOne(settingsUrl)
      .flush(view({ judgeModel: 'openai/gpt-4.1-mini' }));

    expect(component.judgeModel()).toBe('openai/gpt-4.1-mini');
    component.judgeModel.set('');
    component.save();

    const req = http.expectOne(settingsUrl);
    expect(req.request.body).toEqual({
      judgeModel: null,
      databricksReasoningEffort: false,
    });
    req.flush({ ok: true, message: 'Engine settings saved' });
  });

  it('resetToDefaults sends only `defaults: productionDefaults`', () => {
    component.setBoolean('sqlPrecheck', true);
    component.judgeModel.set('openai/gpt-4.1-mini');
    component.resetToDefaults();

    const req = http.expectOne(settingsUrl);
    expect(req.request.method).toBe('PUT');
    expect(req.request.body).toEqual({ defaults: PRODUCTION_DEFAULTS });
    req.flush({ ok: true, message: 'Engine settings reset', settings: view() });
  });

  it('flags a lever as changed once it differs from production defaults, and clears when reverted', () => {
    expect(component.isChanged('sqlPrecheck')).toBeFalse();
    component.setBoolean('sqlPrecheck', true);
    expect(component.isChanged('sqlPrecheck')).toBeTrue();
    component.setBoolean('sqlPrecheck', false);
    expect(component.isChanged('sqlPrecheck')).toBeFalse();
  });

  it('flags careful mode and reasoning-effort overrides as changed', () => {
    expect(component.isChanged('careful')).toBeFalse();
    component.setCareful('auto');
    expect(component.isChanged('careful')).toBeTrue();

    expect(component.isChanged('reasoningEffort')).toBeFalse();
    component.setReasoningEffort('medium');
    expect(component.isChanged('reasoningEffort')).toBeTrue();
    component.setReasoningEffort('');
    expect(component.isChanged('reasoningEffort')).toBeFalse();
  });

  it('renders the memory lever with three options and updates the working copy', () => {
    fixture.detectChanges();
    const select: HTMLSelectElement = fixture.nativeElement.querySelector(
      '[data-testid="engine-lever-memory"]',
    );
    expect(select).not.toBeNull();
    expect(select.value).toBe('off');
    expect(Array.from(select.options).map((o) => o.value)).toEqual([
      'off',
      'recall',
      'recall+models',
    ]);

    select.value = 'recall+models';
    select.dispatchEvent(new Event('change'));
    expect(component.options().memory).toBe('recall+models');
    expect(component.isChanged('memory')).toBeTrue();

    component.setMemory('bogus');
    expect(component.options().memory).toBe('recall+models');

    component.save();
    const req = http.expectOne(settingsUrl);
    expect(req.request.body.defaults.memory).toBe('recall+models');
    req.flush({ ok: true, message: 'Engine settings saved' });
  });

  it('accepts a well-formed judge model router id', () => {
    component.judgeModel.set('openai/gpt-4.1-mini');
    expect(component.judgeModelError()).toBeNull();
    expect(component.canSave()).toBeTrue();
  });

  it('rejects a judge model that is not "<provider>/<model>"', () => {
    component.judgeModel.set('not-a-router-id');
    expect(component.judgeModelError()).not.toBeNull();
    expect(component.canSave()).toBeFalse();
  });

  it('treats an empty judge model as valid (falls back to the assistant model)', () => {
    component.judgeModel.set('   ');
    expect(component.judgeModelError()).toBeNull();
    expect(component.canSave()).toBeTrue();
  });

  it('"remove all" rule groups stores a single wildcard', () => {
    component.removeAllRuleGroups();
    expect(component.options().promptAblation).toEqual(['*']);
    expect(component.isGroupAblated('visuals')).toBeTrue();
    expect(component.isGroupAblated('rationale')).toBeTrue();
  });

  it('unchecking one group while "remove all" is active expands the wildcard', () => {
    component.removeAllRuleGroups();
    component.toggleRuleGroup('visuals');
    expect(component.options().promptAblation).toEqual(['rationale']);
    expect(component.isGroupAblated('visuals')).toBeFalse();
    expect(component.isGroupAblated('rationale')).toBeTrue();
  });

  it('toggles an individual rule group on and off', () => {
    component.toggleRuleGroup('visuals');
    expect(component.options().promptAblation).toEqual(['visuals']);
    component.toggleRuleGroup('visuals');
    expect(component.options().promptAblation).toEqual([]);
  });

  it('blank max-steps clears the override; a valid integer sets it', () => {
    component.setMaxSteps('12');
    expect(component.options().maxSteps).toBe(12);
    component.setMaxSteps('');
    expect(component.options().maxSteps).toBeUndefined();
  });

  it('an unparsable max-steps value leaves the stored option untouched', () => {
    component.setMaxSteps('12');
    component.setMaxSteps('abc');
    expect(component.maxStepsText()).toBe('abc');
    expect(component.options().maxSteps).toBe(12);
  });
});
