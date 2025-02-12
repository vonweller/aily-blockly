import { HttpClient } from '@angular/common/http';
import { Injectable } from '@angular/core';

@Injectable({
  providedIn: 'root'
})
export class ConfigService {

  boardList = [
    {

    }
  ]

  constructor(
    private http: HttpClient
  ) { }


  async init() {
    // this.boardConfig = await lastValueFrom(
    //   this.http.get<any[]>('board/arduino_uno/arduino_uno.json', {
    //     responseType: 'json',
    //   }),
    // );
  }
}
