import { Injectable } from '@angular/core';
import { Subject } from 'rxjs';

@Injectable({
  providedIn: 'root',
})
export class ToolContainerService {
  actionSubject = new Subject();

  constructor() {}
}
