import { Component, inject } from '@angular/core';
import {
  LucideAngularModule,
  LucideIconData,
  Monitor,
  Moon,
  Sun,
} from 'lucide-angular';
import {
  ThemePreference,
  ThemeService,
} from '../../../../core/theme/theme.service';

interface ThemeOption {
  value: ThemePreference;
  label: string;
  icon: LucideIconData;
}

@Component({
  selector: 'app-appearance-settings',
  imports: [LucideAngularModule],
  templateUrl: './appearance-settings.html',
})
export class AppearanceSettings {
  readonly theme = inject(ThemeService);

  readonly options: ThemeOption[] = [
    { value: 'system', label: 'System', icon: Monitor },
    { value: 'light', label: 'Light', icon: Sun },
    { value: 'dark', label: 'Dark', icon: Moon },
  ];
}
