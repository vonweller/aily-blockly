import { Component, OnInit, OnDestroy, Input, ViewChild, ElementRef, AfterViewInit, HostListener } from '@angular/core';
import { CommonModule } from '@angular/common';
import { BitmapUploadService } from '../../bitmap-upload.service';
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
export class ImageUploadDialogComponent implements OnInit, AfterViewInit, OnDestroy {
  @Input() title = '上传图片';
  @Input() outputWidth = 128;  // 可配置输出宽度
  @Input() outputHeight = 64;  // 可配置输出高度
  @Input() maxFileSize = 10 * 1024 * 1024; // 10MB
  @Input() acceptedTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];

  @ViewChild('cropperImage') cropperImage!: ElementRef<HTMLImageElement>;

  imageUrl: string | null = null;
  cropper: Cropper | null = null;
  isLoading = false;
  isDragOver = false;
  constructor(
    private bitmapUploadService: BitmapUploadService,
    private modal: NzModalRef,
    private message: NzMessageService
  ) { }

  // 拖拽事件处理
  @HostListener('dragover', ['$event'])
  onDragOver(event: DragEvent): void {
    event.preventDefault();
    event.stopPropagation();
    this.isDragOver = true;
  }

  @HostListener('dragleave', ['$event'])
  onDragLeave(event: DragEvent): void {
    event.preventDefault();
    event.stopPropagation();
    this.isDragOver = false;
  }

  @HostListener('drop', ['$event'])
  onDrop(event: DragEvent): void {
    event.preventDefault();
    event.stopPropagation();
    this.isDragOver = false;

    const files = event.dataTransfer?.files;
    if (files && files.length > 0) {
      this.handleFileSelect(files[0]);
    }
  }  onClose(): void {
    this.releaseImageResources();
    this.modal.triggerCancel();
  }

  onConfirm(): void {
    if (!this.cropper) {
      this.message.error('请先选择图片');
      return;
    }

    try {
      this.isLoading = true;

      // 获取裁剪后的画布
      const canvas = this.cropper.getCroppedCanvas({
        width: this.outputWidth,
        height: this.outputHeight,
        imageSmoothingEnabled: true,
        imageSmoothingQuality: 'high'
      });

      // 转换为 base64
      const croppedImageData = canvas.toDataURL('image/png');

      // 返回结果并关闭弹窗
      this.modal.close(croppedImageData);
    } catch (error) {
      console.error('图片处理失败:', error);
      this.message.error('图片处理失败，请重试');
    } finally {
      this.isLoading = false;
    }
  }

  onFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    if (input.files && input.files[0]) {
      this.handleFileSelect(input.files[0]);
    }
  }  handleFileSelect(file: File): void {
    // 验证文件类型
    if (!this.acceptedTypes.includes(file.type)) {
      this.message.error('请选择支持的图片格式 (JPEG, PNG, GIF, WebP)');
      return;
    }

    // 验证文件大小
    if (file.size > this.maxFileSize) {
      this.message.error(`图片大小不能超过 ${Math.round(this.maxFileSize / 1024 / 1024)}MB`);
      return;
    }

    // 在加载新图片前释放之前的资源
    this.releaseImageResources();

    this.isLoading = true;
    console.log('Starting file processing...');

    const reader = new FileReader();    reader.onload = (e) => {
      this.imageUrl = e.target?.result as string;
      console.log('File read complete, imageUrl set');

      // 等待DOM更新完成，然后初始化cropper
      setTimeout(() => {
        this.initCropper();
      }, 50); // 减少延迟时间
    };

    reader.onerror = () => {
      console.error('FileReader error');
      this.message.error('文件读取失败');
      this.isLoading = false;
    };

    reader.readAsDataURL(file);  }initCropper(): void {
    if (!this.cropperImage?.nativeElement || !this.imageUrl) {
      console.warn('Cropper initialization failed: missing image element or imageUrl');
      return;
    }

    // 销毁已存在的cropper
    this.destroyCropper();

    const image = this.cropperImage.nativeElement;

    // 清除之前的事件监听器，避免事件处理器冲突
    image.onload = null;
    image.onerror = null;

    // 设置图片样式 - 确保初始状态就是隐藏的
    image.style.display = 'none';
    image.style.width = 'auto';
    image.style.height = 'auto';
    image.style.maxWidth = '100%';
    image.style.maxHeight = '100%';

    console.log('Initializing cropper with imageUrl:', this.imageUrl.substring(0, 50) + '...');

    // 设置新的事件处理器
    image.onload = () => {
      // console.log('Image loaded, creating cropper');
      // console.log('Image natural size:', image.naturalWidth, 'x', image.naturalHeight);
      // console.log('Image display size:', image.offsetWidth, 'x', image.offsetHeight);
      try {
        // 图片已经在初始化时设置为隐藏，现在直接创建cropper
        this.cropper = new Cropper(image, {
          aspectRatio: this.outputWidth / this.outputHeight,
          viewMode: 1,
          dragMode: 'move', // 设置为移动模式，允许拖拽图片
          autoCrop: true,
          autoCropArea: 0.8,
          movable: true, // 允许移动图片
          zoomable: true, // 允许缩放图片
          zoomOnWheel: true, // 允许鼠标滚轮缩放
          cropBoxMovable: false, // 裁剪框不可移动
          cropBoxResizable: false, // 裁剪框不可调整大小
          guides: true,
          center: true,
          highlight: true,
          background: true,
          modal: true,
          responsive: true,
          restore: false, // 不恢复裁剪状态
          checkCrossOrigin: false, // 不检查跨域
          checkOrientation: false, // 不检查图片方向
          ready: () => {
            // Cropper准备就绪后立即停止加载状态
            this.isLoading = false;
            // 确保裁剪框正确显示和居中
            if (this.cropper) {
              this.cropper.crop();
            }
          }
        });
      } catch (error) {
        console.error('Failed to initialize cropper:', error);
        this.message.error('图片裁剪器初始化失败');
        this.isLoading = false;
      }
    };

    image.onerror = () => {
      console.error('Image load failed for src:', image.src);
      this.message.error('图片加载失败');
      this.isLoading = false;
    };

    // 最后设置图片源，触发加载
    image.src = this.imageUrl;
  }
  destroyCropper(): void {
    if (this.cropper) {
      this.cropper.destroy();
      this.cropper = null;
    }
  }
  // 释放图片资源，避免内存泄漏
  releaseImageResources(): void {
    // 销毁现有的cropper
    this.destroyCropper();
    
    // 清除图片元素的事件监听器
    if (this.cropperImage?.nativeElement) {
      const image = this.cropperImage.nativeElement;
      image.onload = null;
      image.onerror = null;
    }
    
    // 如果当前的imageUrl是blob URL，需要释放它
    if (this.imageUrl && this.imageUrl.startsWith('data:')) {
      // data URL不需要特殊释放，但我们仍然清空引用
      this.imageUrl = null;
    } else if (this.imageUrl && this.imageUrl.startsWith('blob:')) {
      // 如果是blob URL，使用URL.revokeObjectURL释放
      URL.revokeObjectURL(this.imageUrl);
      this.imageUrl = null;
    } else {
      // 其他情况直接清空引用
      this.imageUrl = null;
    }
  }
  // 重置组件状态
  resetComponent(): void {
    this.releaseImageResources();
    this.isLoading = false;
    this.isDragOver = false;
  }

  // 重新居中裁剪框
  centerCropBox(): void {
    if (this.cropper) {
      this.cropper.reset();
    }
  }

  // 重置图片和裁剪框到初始状态
  resetCropper(): void {
    if (this.cropper) {
      this.cropper.reset();
      this.cropper.clear();
      this.cropper.crop();
    }
  }

  // 获取当前裁剪预览
  getCropPreview(): string | null {
    if (!this.cropper) {
      return null;
    }

    try {
      const canvas = this.cropper.getCroppedCanvas({
        width: this.outputWidth,
        height: this.outputHeight,
        imageSmoothingEnabled: true,
        imageSmoothingQuality: 'high'
      });
      return canvas.toDataURL('image/png');
    } catch (error) {
      console.error('获取预览失败:', error);
      return null;
    }
  }

  // 测试 Cropper 状态的方法
  testCropper(): void {
    console.log('=== Cropper Debug Info ===');
    console.log('imageUrl:', this.imageUrl);
    console.log('isLoading:', this.isLoading);
    console.log('cropper instance:', this.cropper);
    console.log('image element:', this.cropperImage?.nativeElement);

    if (this.cropperImage?.nativeElement) {
      const img = this.cropperImage.nativeElement;
      console.log('Image src:', img.src);
      console.log('Image display:', img.style.display);
      console.log('Image offsetWidth:', img.offsetWidth);
      console.log('Image offsetHeight:', img.offsetHeight);
    }

    if (this.cropper) {
      console.log('Cropper data:', this.cropper.getData());
    }
    console.log('========================');
  }

  ngOnInit(): void {
    // Component initialization
  }
  ngAfterViewInit(): void {
    console.log('ImageUploadDialog AfterViewInit');
    console.log('cropperImage element:', this.cropperImage?.nativeElement);
  }
  ngOnDestroy(): void {
    this.releaseImageResources();
  }
}
