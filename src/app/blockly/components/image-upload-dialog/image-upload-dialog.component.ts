import { Component, OnInit, OnDestroy, Input, ViewChild, ElementRef, AfterViewInit, HostListener } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Subscription } from 'rxjs';
import { BitmapUploadService, BitmapUploadRequest, BitmapUploadResponse } from '../../bitmap-upload.service';
import { NzButtonModule } from 'ng-zorro-antd/button';
import { NzIconModule } from 'ng-zorro-antd/icon';
import { NzMessageService } from 'ng-zorro-antd/message';
import { FormsModule } from '@angular/forms';
import { NzModalRef } from 'ng-zorro-antd/modal';
import Cropper from 'cropperjs';

@Component({
  selector: 'app-image-upload-dialog',
  standalone: true,
  imports: [CommonModule, FormsModule, NzButtonModule, NzIconModule],
  templateUrl: './image-upload-dialog.component.html',
  styleUrls: ['./image-upload-dialog.component.scss']
})
export class ImageUploadDialogComponent implements OnInit, OnDestroy, AfterViewInit {
  @Input() title = '上传图片';
  @ViewChild('cropperImage') cropperImage!: ElementRef<HTMLImageElement>;
  
  value = '';
  croppedImageData: string | null = null;
  imageUrl: string | null = null;
  cropper: any = null;

  constructor(
    private bitmapUploadService: BitmapUploadService,
    private modal: NzModalRef,
    private message: NzMessageService
  ) { }
  onClose() {
    this.destroyCropper();
    this.modal.triggerCancel();
  }

  onConfirm() {
    if (this.croppedImageData) {
      this.destroyCropper();
      this.modal.close(this.croppedImageData);
    }
  }

  ngAfterViewInit() {
    // cropper will be initialized after image loads
  }

  onFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    if (input.files && input.files.length > 0) {
      const file = input.files[0];
      this.handleFileSelect(file);
    }
  }

  handleFileSelect(file: File): void {
    if (file.type.indexOf('image/') !== 0) {
      this.message.error('请选择图片文件!');
      return;
    }

    // 销毁之前的cropper实例
    this.destroyCropper();

    const reader = new FileReader();
    reader.onload = (e: any) => {
      this.imageUrl = e.target.result;
      this.croppedImageData = null;
      
      // 等待Angular更新DOM，然后等待图片加载完成
      setTimeout(() => {
        if (this.cropperImage?.nativeElement) {
          const img = this.cropperImage.nativeElement;
          if (img.complete) {
            // 图片已经加载完成
            this.initCropper();
          } else {
            // 等待图片加载完成
            img.onload = () => {
              this.initCropper();
            };
          }
        }
      }, 50);
    };

    reader.readAsDataURL(file);
  }initCropper() {
    if (this.cropperImage?.nativeElement) {
      this.destroyCropper();
      
      try {
        // 配置 Cropper 以填充满容器
        this.cropper = new Cropper(this.cropperImage.nativeElement, {
          autoCropArea: 1, // 自动裁剪区域占图像的比例（1 = 100%）
          ready: () => {
            console.log('Cropper ready');
            // 设置裁剪框填充满可视区域
            setTimeout(() => {
              if (this.cropper) {
                this.cropper.crop();
              }
            }, 100);
          },
          crop: (event: any) => {
            // 裁剪时自动更新裁剪数据
            this.cropImage();
          }
        } as any);
      } catch (error) {
        console.error('初始化Cropper失败:', error);
        this.message.error('初始化裁剪功能失败');
      }
    }
  }

  destroyCropper() {
    if (this.cropper) {
      this.cropper.destroy();
      this.cropper = null;
    }
  }

  resetCropper() {
    if (this.cropper) {
      this.cropper.reset();
    }
  }
  cropImage() {
    if (!this.cropper) {
      this.message.error('请先选择图片');
      return;
    }

    try {
      // 获取裁剪后的canvas
      const canvas = this.cropper.getCroppedCanvas();

      if (canvas) {
        this.croppedImageData = canvas.toDataURL('image/png');
        this.message.success('图片裁剪成功!');
      } else {
        this.message.error('图片裁剪失败');
      }
    } catch (error) {
      console.error('裁剪图片失败:', error);
      this.message.error('图片裁剪失败');
    }
  }

  onImageCropped(imageData: string) {
    this.croppedImageData = imageData;
  }
  @HostListener('document:keydown', ['$event'])
  onKeyDown(event: KeyboardEvent): void {
    if (!this.cropper || !this.imageUrl) return;

    switch (event.key) {
      case 'Escape':
        event.preventDefault();
        this.onClose();
        break;
      case 'Enter':
        if (event.ctrlKey) {
          event.preventDefault();
          this.cropImage();
        }
        break;
    }
  }

  private uploadSubscription: Subscription = new Subscription();

  lastRequest: BitmapUploadRequest | null = null;
  isProcessing: boolean = false;

  ngOnInit() {
    // Subscribe to upload requests from bitmap field
    this.uploadSubscription = this.bitmapUploadService.uploadRequest$.subscribe(
      (request: BitmapUploadRequest) => {
        console.log('Received bitmap upload request:', request);
        this.lastRequest = request;
        this.isProcessing = false;

        // Automatically process the request after a short delay
        setTimeout(() => {
          this.processLastRequest();
        }, 1000);
      }
    );
  }
  ngOnDestroy() {
    this.uploadSubscription.unsubscribe();
    this.destroyCropper();
  }

  /**
   * Process the last upload request
   */
  processLastRequest() {
    if (!this.lastRequest) return;

    this.isProcessing = true;

    // Simulate processing delay
    setTimeout(() => {
      // Create a simple processing example - just return the same bitmap
      const response: BitmapUploadResponse = {
        processedBitmap: this.lastRequest!.currentBitmap,
        success: true,
        message: 'Bitmap processed successfully',
        timestamp: Date.now()
      };

      this.bitmapUploadService.sendUploadResponse(response);
      this.isProcessing = false;
    }, 2000);
  }

  /**
   * Simulate processing with bitmap inversion
   */
  simulateProcessedResponse() {
    if (!this.lastRequest) return;

    this.isProcessing = true;

    // Simulate processing delay
    setTimeout(() => {
      // Create inverted bitmap
      const invertedBitmap = this.lastRequest!.currentBitmap.map(row =>
        row.map(pixel => pixel === 1 ? 0 : 1)
      );

      const response: BitmapUploadResponse = {
        processedBitmap: invertedBitmap,
        success: true,
        message: 'Bitmap inverted successfully',
        timestamp: Date.now()
      };

      this.bitmapUploadService.sendUploadResponse(response);
      this.isProcessing = false;
    }, 1500);
  }
}
