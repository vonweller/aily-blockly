import { Component } from '@angular/core';
import { ITEM_LIST } from '../data';
import { SimplebarAngularModule } from 'simplebar-angular';
import { NzButtonModule } from 'ng-zorro-antd/button';

@Component({
  selector: 'app-subject-item',
  imports: [SimplebarAngularModule, NzButtonModule],
  templateUrl: './subject-item.component.html',
  styleUrl: './subject-item.component.scss'
})
export class SubjectItemComponent {

  itemList = ITEM_LIST

  options = {
    autoHide: true,
    clickOnTrack: true,
    scrollbarMinSize: 50,
  };
}
