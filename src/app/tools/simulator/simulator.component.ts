import { Component } from '@angular/core';
import { ToolContainerComponent } from '../../components/tool-container/tool-container.component';
import { SubWindowComponent } from '../../components/sub-window/sub-window.component';
import { Router } from '@angular/router';

@Component({
  selector: 'app-simulator',
  imports: [
    ToolContainerComponent,
    SubWindowComponent
  ],
  templateUrl: './simulator.component.html',
  styleUrl: './simulator.component.scss'
})
export class SimulatorComponent {

  currentUrl;

  constructor(
    private router: Router
  ) {

  }

  ngOnInit() {
    this.currentUrl = this.router.url;
  }

  close() {

  }
}
