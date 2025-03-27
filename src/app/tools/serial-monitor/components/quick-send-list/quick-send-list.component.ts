import { Component, ElementRef, ViewChild } from '@angular/core';
import { SimplebarAngularComponent, SimplebarAngularModule } from 'simplebar-angular';
import { SerialMonitorService } from '../../serial-monitor.service';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-quick-send-list',
  imports: [SimplebarAngularModule, CommonModule],
  templateUrl: './quick-send-list.component.html',
  styleUrl: './quick-send-list.component.scss'
})
export class QuickSendListComponent {

  @ViewChild(SimplebarAngularComponent) simplebar: SimplebarAngularComponent;

  options2 = {
    autoHide: true,
    clickOnTrack: true,
    scrollbarMinSize: 10
  };

  get quickSendList() {
    return this.serialMonitorService.quickSendList;
  }

  constructor(private serialMonitorService: SerialMonitorService) { }

  ngAfterViewInit() {
    const simplebarElement = this.simplebar.SimpleBar.getScrollElement()

    simplebarElement.addEventListener('wheel', (event: WheelEvent) => {
      // console.log('wheel', event);
      event.preventDefault();
      const scrollAmount = event.deltaY || event.deltaX;
      simplebarElement.scrollLeft += scrollAmount * 0.2;
    }, { passive: false });
  }

  send(item) {

  }

  addBtn() {

  }

  delBtn(item) {

  }

  editBtn(item) {

  }
}
