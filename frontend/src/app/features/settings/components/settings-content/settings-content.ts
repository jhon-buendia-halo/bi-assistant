import { Component, inject } from '@angular/core';
import { AppearanceSettings } from '../../../appearance/components/appearance-settings/appearance-settings';
import { DatasourceConfig } from '../../../datasources/components/datasource-config/datasource-config';
import { DeveloperSettingsConfig } from '../../../developer/components/developer-settings/developer-settings';
import { LlmConfig } from '../../../llm/components/llm-config/llm-config';
import { TestingDataConfig } from '../../../testing-data/components/testing-data-config/testing-data-config';
import { SettingsState } from '../../services/settings-state';

/** The chosen Settings section's form (area container). */
@Component({
  selector: 'app-settings-content',
  imports: [
    DatasourceConfig,
    LlmConfig,
    TestingDataConfig,
    DeveloperSettingsConfig,
    AppearanceSettings,
  ],
  templateUrl: './settings-content.html',
  styles: ':host { display: contents; }',
})
export class SettingsContent {
  readonly settings = inject(SettingsState);
}
