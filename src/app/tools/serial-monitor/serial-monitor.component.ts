import { Component, ElementRef, ViewChild, viewChild } from '@angular/core';
import { InnerWindowComponent } from '../../components/inner-window/inner-window.component';
@Component({
  selector: 'app-serial-monitor',
  imports: [InnerWindowComponent],
  templateUrl: './serial-monitor.component.html',
  styleUrl: './serial-monitor.component.scss'
})
export class SerialMonitorComponent {

  ngOnInit() {
  }

  ngAfterViewInit(): void {

  }

}
