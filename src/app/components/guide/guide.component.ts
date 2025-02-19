import { Component } from '@angular/core';
import { version } from '../../../../package.json';

@Component({
  selector: 'app-guide',
  imports: [],
  templateUrl: './guide.component.html',
  styleUrl: './guide.component.scss'
})
export class GuideComponent {
  version = version;
}
