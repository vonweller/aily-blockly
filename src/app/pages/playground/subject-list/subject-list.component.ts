import { Component } from '@angular/core';
import { SUBJECT_LIST } from '../data';
import { RouterModule } from '@angular/router';

@Component({
  selector: 'app-subject-list',
  imports: [RouterModule],
  templateUrl: './subject-list.component.html',
  styleUrl: './subject-list.component.scss'
})
export class SubjectListComponent {


  subjectList = SUBJECT_LIST
}
