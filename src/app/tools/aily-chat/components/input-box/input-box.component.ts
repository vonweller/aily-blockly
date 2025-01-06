import { ChangeDetectorRef, Component, ElementRef, OnInit, ViewChild } from '@angular/core';
import { ChatService } from '../../services/chat.service';
import { SpeechService } from '../../services/speech.service';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { NzButtonModule } from 'ng-zorro-antd/button';
import { NzMessageService } from 'ng-zorro-antd/message';
import { NzUploadFile, NzUploadModule } from 'ng-zorro-antd/upload';
import { NzInputModule } from 'ng-zorro-antd/input';

@Component({
  selector: 'qa-input',
  templateUrl: './input-box.component.html',
  styleUrls: ['./input-box.component.scss'],
  standalone: true,
  imports: [CommonModule, FormsModule, NzButtonModule, NzUploadModule, NzInputModule]
})
export class InputBoxComponent implements OnInit {

  // get user() {
  //   return this.supabaseService.user
  // }

  inputMode = false;

  message: string = '';

  get isRecognition() {
    return false
  }

  get isResponding() {
    return false
  }


  showImageInput = false;

  @ViewChild('textarea') textarea: ElementRef;

  constructor(
    private chatService: ChatService,
    // private viewService: ViewService,
    private speechService: SpeechService,
    private cd: ChangeDetectorRef,
    private messageService: NzMessageService
  ) { }

  ngOnInit(): void {
    // this.speechService.nextInput.subscribe(() => {
    //   this.speech()
    // })
  }

  ngAfterViewInit(): void {
    this.initFileZone()
  }

  async publish(e = null) {
    if (e == null) {
      this.sendMessage()
    } else if (e.key === 'Enter' && e.ctrlKey) {
      const startPos = (e.target as HTMLTextAreaElement).selectionStart;
      const value = (e.target as HTMLTextAreaElement).value;
      this.message = value.substring(0, startPos) + '\n' + value.substring(startPos);
      setTimeout(() => {
        (e.target as HTMLTextAreaElement).selectionStart = startPos + 1;
        (e.target as HTMLTextAreaElement).selectionEnd = startPos + 1;
      });
      e.preventDefault();
      this.checkHeight()
    } else if (e.key === 'Backspace') {
      // this.checkHeight()
    } else if (e.key === 'Enter') {
      e.preventDefault();
      this.sendMessage()
    }
  }

  checkHeight() {
    let num = this.message.split("\n").length
    num == 0 ? num = 1 : num
    this.textarea.nativeElement.rows = num
  }

  messageChange() {
    this.checkHeight()
  }

  sendMessage() {
    if (/^[\n\s]*$/.test(this.message)) return
    if (this.isResponding) {
      this.messageService.info('Aily正在回复中，请本次回复完成后，再发送新消息')
      return
    }
    // this.chatService.sendMessage(this.message)
    setTimeout(() => {
      this.message = ''
      this.checkHeight()
      this.showImageInput = false;
    }, 100);
  }

  openAuthModel() {
    // this.viewService.showAuthModal()
  }

  speech() {
    // this.speechService.recognition().subscribe(
    //   (res: any) => {
    //     this.message = res
    //     this.cd.detectChanges()
    //   },
    //   (err) => { },
    //   () => {
    //     this.publish();
    //   }
    // )
    // setTimeout(() => {
    //   this.cd.detectChanges()
    // }, 200);
  }

  fileList: any = [];

  beforeUpload = (file: NzUploadFile): boolean => {
    console.log(file);
    file.url = URL.createObjectURL(file as any);
    this.fileList = this.fileList.concat({
      uid: file.uid,
      name: file.name,
      status: 'done',
      url: file.url,
    });
    return false;
  };

  @ViewChild('fileZone') fileZone: ElementRef;
  initFileZone() {

    const dropZone = this.fileZone.nativeElement

    dropZone.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.stopPropagation();
      dropZone.classList.add('dragover');
    });

    dropZone.addEventListener('dragleave', (e) => {
      e.preventDefault();
      e.stopPropagation();
      dropZone.classList.remove('dragover');
    });

    dropZone.addEventListener('drop', (e) => {
      e.preventDefault();
      e.stopPropagation();
      dropZone.classList.remove('dragover');

      const files = e.dataTransfer.files;
      console.log(files);
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        file.url = URL.createObjectURL(file as any);
        this.fileList = this.fileList.concat({
          uid: file.uid,
          name: file.name,
          status: 'done',
          url: file.url,
        });
      }
      this.showImageInput = true;
    });
  }
}
