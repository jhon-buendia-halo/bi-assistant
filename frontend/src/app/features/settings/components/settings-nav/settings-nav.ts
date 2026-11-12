import { Component, inject } from '@angular/core';
import { LucideAngularModule, Search } from 'lucide-angular';
import { APP_VERSION } from '../../../../core/config/app-version';
import { SettingsState } from '../../services/settings-state';

/** The Settings list pane: search, the sections and the app version. */
@Component({
  selector: 'app-settings-nav',
  imports: [LucideAngularModule],
  templateUrl: './settings-nav.html',
  styles: ':host { display: contents; }',
})
export class SettingsNav {
  readonly settings = inject(SettingsState);
  readonly Search = Search;
  /** Shown in the settings sidebar footer; matches the installer's version. */
  readonly appVersion = APP_VERSION;
}
