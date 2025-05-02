import { Component } from '@angular/core';
import { ITEM_LIST } from '../data';

@Component({
  selector: 'app-subject-item',
  imports: [],
  templateUrl: './subject-item.component.html',
  styleUrl: './subject-item.component.scss'
})
export class SubjectItemComponent {

  itemList = ITEM_LIST
}
