import { Component, EventEmitter, Output } from '@angular/core';
import { NpmService } from '../../../../services/npm.service';
import { NzInputModule } from 'ng-zorro-antd/input';
import { NzButtonModule } from 'ng-zorro-antd/button';
import { NzToolTipModule } from 'ng-zorro-antd/tooltip';
import { NzSelectModule } from 'ng-zorro-antd/select';
import { FormsModule } from '@angular/forms';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-lib-manager',
  imports: [
    FormsModule,
    CommonModule,
    NzInputModule,
    NzButtonModule,
    NzToolTipModule,
    NzSelectModule 
  ],
  templateUrl: './lib-manager.component.html',
  styleUrl: './lib-manager.component.scss'
})
export class LibManagerComponent {

  @Output() close = new EventEmitter();

  libList: PackageInfo[] = [];

  version;
  versionList=[]

  constructor(
    private npmService: NpmService
  ) { }

  ngOnInit(): void {
    this.npmService.search({ text: 'lib-' }).subscribe(res => {
      console.log(res);
      this.libList = res.objects.map(item => item.package);
    })
  }

  processForSearch(array) {
    for (let index = 0; index < array.length; index++) {
      const item = array[index];
      item['fulltext'] = `${item.nickname} ${item.description} ${item.keywords.join(' ')}${item.brand} ${item.author.name}`;
    }
  }

  back() {
    this.close.emit();
  }

  installLib(lib){

  }

  removeLib(lib){

  }
}

interface PackageInfo {
  "name": string,
  "nickname": string,
  "scope"?: string,
  "description"?: string,
  "version"?: string,
  "keywords"?: string[],
  "date"?: string,
  "author"?: {
    "name"?: string
  },
  "publisher"?: any,
  "maintainers"?: any[],
  "links"?: any,
  "brand"?:string,
  "fulltext"?: string
}
