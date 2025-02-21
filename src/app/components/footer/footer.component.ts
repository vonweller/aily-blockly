import { Component } from '@angular/core';
import { UiService } from '../../services/ui.service';

@Component({
  selector: 'app-footer',
  imports: [],
  templateUrl: './footer.component.html',
  styleUrl: './footer.component.scss'
})
export class FooterComponent {
  state: any = {
    'text': 'ready',
    'color': 'green',
    'icon': 'check-circle',
    'timeout': 0
  };
  constructor(private uiService: UiService) {
    this.uiService.stateSubject.subscribe((e: any) => {
      console.log("footer state update", e);
      this.state = e;
    });
  }
}
