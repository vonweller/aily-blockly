import { Component } from '@angular/core';
import { SUBJECT_LIST } from '../data';
import { RouterModule } from '@angular/router';

import { ConfigService } from '../../../services/config.service';

@Component({
  selector: 'app-subject-list',
  imports: [RouterModule],
  templateUrl: './subject-list.component.html',
  styleUrl: './subject-list.component.scss'
})
export class SubjectListComponent {
  subjectList;
  resourceUrl;

  constructor(
    private configService: ConfigService,
  ) {
  }

  ngAfterViewInit() {
    this.resourceUrl = this.configService.data.resource[0] + "/imgs/examples/";
    this.configService.loadExamplesList().then(async (data: any) => {
      this.subjectList = data;
    });
  }

  onImgError(event) {
    (event.target as HTMLImageElement).src = 'imgs/subject.webp';
  }
}
