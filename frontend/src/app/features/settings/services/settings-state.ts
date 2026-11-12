import { Injectable, computed, signal } from '@angular/core';
import {
  Bot,
  Database,
  LucideIconData,
  SunMoon,
  TestTube,
  Wrench,
} from 'lucide-angular';

export type SettingsSection =
  'datasources' | 'llm' | 'testing-data' | 'developer' | 'appearance' | null;

/** The Settings area: its sections and which one is chosen. */
@Injectable({ providedIn: 'root' })
export class SettingsState {
  readonly settingsSection = signal<SettingsSection>(null);

  readonly settingsSections: {
    key: Exclude<SettingsSection, null>;
    label: string;
    icon: LucideIconData;
  }[] = [
    {
      key: 'datasources',
      label: 'Datasource Configuration',
      icon: Database,
    },
    {
      key: 'llm',
      label: 'LLM Configuration',
      icon: Bot,
    },
    {
      key: 'testing-data',
      label: 'Testing Data',
      icon: TestTube,
    },
    {
      key: 'developer',
      label: 'Developer',
      icon: Wrench,
    },
    { key: 'appearance', label: 'Appearance', icon: SunMoon },
  ];

  /** Every Settings section is always offered, in their fixed order. */
  readonly visibleSettingsSections = computed(() => this.settingsSections);

  /** The chosen section, or none when it is hidden (ui.md 1.6). */
  readonly shownSettingsSection = computed<SettingsSection>(() => {
    const section = this.settingsSection();
    return this.visibleSettingsSections().some((item) => item.key === section)
      ? section
      : null;
  });

  selectSection(section: Exclude<SettingsSection, null>): void {
    this.settingsSection.set(
      this.settingsSection() === section ? null : section,
    );
  }
}
