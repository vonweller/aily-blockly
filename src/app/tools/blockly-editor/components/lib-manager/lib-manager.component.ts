import { Component } from '@angular/core';
import { NpmService } from '../../../../services/npm.service';

@Component({
  selector: 'app-lib-manager',
  imports: [],
  templateUrl: './lib-manager.component.html',
  styleUrl: './lib-manager.component.scss'
})
export class LibManagerComponent {

  libList: PackageInfo[] = [];

  constructor(
    private npmService: NpmService
  ) { }

  ngOnInit(): void {
    this.npmService.search({ text: 'lib-' }).subscribe(res => {
      console.log(res);
      this.libList = res.objects.map(item => item.package);
    })
  }

}

interface PackageInfo {
  "name": string,
  "scope": string,
  "description": string,
  "version": string,
  "keywords": string[],
  "date": string,
  "author": {
    "name": string
  },
  "publisher": any,
  "maintainers": any[],
  "links": any
}
