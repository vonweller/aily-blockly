import { HttpClient } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { APP } from '../configs/app.config';
import { lastValueFrom } from 'rxjs';

@Injectable({
  providedIn: 'root'
})
export class BlocklyService {

  constructor(
    private http: HttpClient
  ) { }

  async getLibraries() {
    let core = await lastValueFrom(this.http.get('/public/arduino/libraries/core.json'))
    let libraries = await lastValueFrom(this.http.get('/public/arduino/libraries/libraries.json'))
  }

  // getLibraries() {
  //   return this.http.get(APP.libraryUrl)
  // }

  getLibrariesTags() {
    return this.http.get('https://b4a.clz.me/libraries-tags.json')
  }

  getBoards() {
    return this.http.get(APP.boardUrl)
  }

  getExamples() {
    return this.http.get(APP.exampleUrl)
  }

  loadExample(item) {
    return this.http.get(APP.website + item.url, { responseType: 'text' })
  }

  getLibJson(libName) {
    return this.http.get(`http://b4a.clz.me/libraries/${libName}.json`)
  }
}
