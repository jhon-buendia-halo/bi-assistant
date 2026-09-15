import { Component, inject } from '@angular/core';
import {
  LucideAngularModule,
  CircleAlert,
  CircleCheck,
  Info,
  X,
} from 'lucide-angular';
import { ToastService } from '../../../core/toast/toast.service';

@Component({
  selector: 'app-toast-container',
  imports: [LucideAngularModule],
  templateUrl: './toast-container.html',
  styleUrl: './toast-container.scss',
})
export class ToastContainer {
  readonly CircleAlert = CircleAlert;
  readonly CircleCheck = CircleCheck;
  readonly Info = Info;
  readonly X = X;

  readonly toastService = inject(ToastService);
}
