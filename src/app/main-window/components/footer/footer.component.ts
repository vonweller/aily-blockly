import { Component, ChangeDetectorRef } from '@angular/core';
import { UiService } from '../../../services/ui.service';

@Component({
  selector: 'app-footer',
  imports: [],
  templateUrl: './footer.component.html',
  styleUrl: './footer.component.scss'
})
export class FooterComponent {
  data: State = {
    state: '',
    text: '',
    desc: '',
    color: '',
    icon: '',
    timeout: 0
  };
  constructor(
    private uiService: UiService,
    private cd: ChangeDetectorRef
  ) {
    this.uiService.stateSubject.subscribe((e: any) => {
      // console.log("footer state update", e);
      this.data = e;
      this.cd.detectChanges();
    });
  }
}

interface State {
  text: string;
  desc?: string;
  state?: 'done' | 'error' | 'warn' | 'loading' | string,
  color?: string;
  icon?: string;
  timeout?: number;
}
