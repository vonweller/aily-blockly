import {
  Component,
  ElementRef,
  Input,
  OnInit,
  SecurityContext,
  ViewChild,
} from '@angular/core';
import { ChatService } from '../../services/chat.service';
import { NzMessageService } from 'ng-zorro-antd/message';
import { SpeechService } from '../../services/speech.service';
import { CommonModule } from '@angular/common';
import { NzAvatarModule } from 'ng-zorro-antd/avatar';
import { NzButtonModule } from 'ng-zorro-antd/button';
import { DomSanitizer } from '@angular/platform-browser';
import { NzImageModule } from 'ng-zorro-antd/image';
import { FormsModule } from '@angular/forms';
import { MarkdownPipe } from '../../pipes/markdown.pipe';
// import { AilyCodingComponent } from '../../../../components/aily-coding/aily-coding.component';

@Component({
  selector: 'aily-dialog',
  templateUrl: './dialog.component.html',
  styleUrls: ['./dialog.component.scss'],
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    NzAvatarModule,
    NzButtonModule,
    MarkdownPipe,
    NzImageModule,
    // AilyCodingComponent,
  ],
})
export class DialogComponent implements OnInit {
  @Input()
  data: any;

  get isDone() {
    if (typeof this.data.isDone == 'boolean') return this.data.isDone;
    return true;
  }

  set isDone(val) {
    this.data.isDone = val;
  }

  get mine() {
    return this.data.role == 'user';
  }

  get system() {
    return this.data.system;
  }

  get user() {
    return '';
  }

  loaded = false;

  constructor(
    private message: NzMessageService,
    private speechService: SpeechService,
    private sanitizer: DomSanitizer,
    private chatService: ChatService,
  ) {}

  ngOnInit(): void {}

  getSafeHTML(html: string) {
    return this.sanitizer.sanitize(SecurityContext.HTML, html);
  }

  ngAfterViewInit(): void {

  }

  login() {
    // this.gptService.openAuthModel()
  }

  goto(url) {
    window.open(url, '_blank');
  }
}
