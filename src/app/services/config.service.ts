import { HttpClient } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { lastValueFrom } from 'rxjs';

@Injectable({
  providedIn: 'root',
})
export class ConfigService {
  constructor(private http: HttpClient) {}

  async init() {
   await this.loadBoardList();
  }

  boardList;
  async loadBoardList() {
    this.boardList = await lastValueFrom(
      this.http.get('board/board.json', {
        responseType: 'json',
      }),
    );
  }
}
