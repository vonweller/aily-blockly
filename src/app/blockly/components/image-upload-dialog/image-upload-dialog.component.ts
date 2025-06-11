import { Component, OnInit, OnDestroy, Input, ViewChild, ElementRef, AfterViewInit, HostListener, Renderer2 } from '@angular/core';
import { CommonModule } from '@angular/common';
import { BitmapUploadService } from '../../bitmap-upload.service';
import { NzButtonModule } from 'ng-zorro-antd/button';
import { NzIconModule } from 'ng-zorro-antd/icon';
import { NzMessageService } from 'ng-zorro-antd/message';
import { FormsModule } from '@angular/forms';
import { NzModalRef } from 'ng-zorro-antd/modal';
import Cropper from 'cropperjs';
import { NzSwitchModule } from 'ng-zorro-antd/switch';
import { NzInputNumberModule } from 'ng-zorro-antd/input-number';
import { ConverterService } from './converter.service';

@Component({
  selector: 'app-image-upload-dialog',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    NzButtonModule,
    NzIconModule,
    NzSwitchModule,
    NzInputNumberModule
  ],
  templateUrl: './image-upload-dialog.component.html',
  styleUrls: ['./image-upload-dialog.component.scss']
})
export class ImageUploadDialogComponent implements OnInit, AfterViewInit, OnDestroy {
  @Input() title = '图片取模';
  @Input() outputWidth = 128;  // 可配置输出宽度
  @Input() outputHeight = 64;  // 可配置输出高度
  @Input() maxFileSize = 10 * 1024 * 1024; // 10MB
  @Input() acceptedTypes = ['image/jpeg', 'image/png', 'image/webp'];

  @ViewChild('cropperImage') cropperImage!: ElementRef<HTMLImageElement>;
  @ViewChild("myCanvas") myCanvas;

  imageUrl: string | null = null;
  cropper: Cropper | null = null;
  isLoading = false;
  isDragOver = false;
  private cropChangeTimer: any = null; // 添加防抖定时器

  options = {
    endian: false,
    invert: false,
    dither: false,
    threshold: 127,
  }

  constructor(
    private bitmapUploadService: BitmapUploadService,
    private modal: NzModalRef,
    private message: NzMessageService,
    private renderer: Renderer2,
    private converterService: ConverterService
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
  } onClose(): void {
    this.releaseImageResources();
    this.modal.triggerCancel();
  }

  ngOnInit(): void {
    // Component initialization
  }

  ngAfterViewInit(): void {
    // console.log('ImageUploadDialog AfterViewInit');
    // console.log('cropperImage element:', this.cropperImage?.nativeElement);
  }

  ngOnDestroy(): void {
    // 清除防抖定时器
    if (this.cropChangeTimer) {
      clearTimeout(this.cropChangeTimer);
    }
    this.releaseImageResources();
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
  }

  handleFileSelect(file: File): void {
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

    const reader = new FileReader(); reader.onload = (e) => {
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

    reader.readAsDataURL(file);
  }

  initCropper(): void {
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
      try {
        // 图片已经在初始化时设置为隐藏，现在直接创建cropper
        this.cropper = new Cropper(image, {
          aspectRatio: this.outputWidth / this.outputHeight,
          viewMode: 1,
          dragMode: 'move',
          autoCrop: true,
          autoCropArea: 0.8,
          movable: true,
          zoomable: true,
          zoomOnWheel: true,
          cropBoxMovable: false,
          cropBoxResizable: false,
          guides: true,
          center: true,
          highlight: true,
          background: true,
          modal: true,
          responsive: true,
          restore: false,
          checkCrossOrigin: false,
          checkOrientation: false,
          ready: () => {
            this.isLoading = false;
            if (this.cropper) {
              this.cropper.crop();
              setTimeout(() => {
                // 确保裁剪框居中
                this.onCropChange();
              }, 200);
            }
          },
          // 添加裁剪内容变化事件监听器
          cropend: () => {
            this.onCropChange();
          },
          cropmove: () => {
            this.onCropChange();
          },
          zoom: () => {
            this.onCropChange();
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

  // 添加裁剪内容变化处理方法（带防抖）
  onCropChange(): void {
    // 清除之前的定时器
    if (this.cropChangeTimer) {
      clearTimeout(this.cropChangeTimer);
    }

    // 设置新的定时器，2秒后执行
    this.cropChangeTimer = setTimeout(() => {
      this.handleCropChange();
    }, 1000);
  }

  // 实际处理裁剪变化的方法
  async handleCropChange() {
    if (!this.cropper) {
      return;
    }

    try {
      // 获取当前裁剪数据
      // const cropData = this.cropper.getData();
      // console.log('裁剪内容已变化:', cropData);

      // 在这里添加您需要的处理逻辑
      // 例如：自动转换为bitmap、更新预览等

      let image = await this.cropDataToImage()
      this.convert2bitmap(image);

    } catch (error) {
      console.error('处理裁剪变化失败:', error);
    }
  }

  destroyCropper(): void {
    // 清除防抖定时器
    if (this.cropChangeTimer) {
      clearTimeout(this.cropChangeTimer);
      this.cropChangeTimer = null;
    }

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
  }

  result;
  convert2bitmap(image: HTMLImageElement) {
    console.log(this.options);
    let canvas: HTMLCanvasElement = this.myCanvas.nativeElement;
    let context = canvas.getContext("2d");
    this.renderer.setAttribute(canvas, "width", image.width.toString() + 'px')
    this.renderer.setAttribute(canvas, "height", image.height.toString() + 'px')
    this.renderer.setStyle(canvas, "transform", 'scale(1.5)')
    context.clearRect(0, 0, this.outputWidth, this.outputHeight);
    context.drawImage(image, 0, 0);
    let imageData = context.getImageData(0, 0, image.width, image.height);
    this.converterService.convert(context, imageData, this.options);
  }

  private cropDataToImage(): Promise<HTMLImageElement> {
    return new Promise((resolve, reject) => {
      if (!this.cropper) {
        reject(new Error('Cropper实例不存在'));
        return;
      }

      try {
        // 获取裁剪后的画布
        const canvas = this.cropper.getCroppedCanvas({
          width: this.outputWidth,
          height: this.outputHeight,
          imageSmoothingEnabled: true,
          imageSmoothingQuality: 'high'
        });

        // 将画布转换为data URL
        const dataURL = canvas.toDataURL('image/png');

        // 创建新的Image对象
        const image = new Image();

        // 设置图片加载完成的回调
        image.onload = () => {
          resolve(image);
        };

        // 设置图片加载失败的回调
        image.onerror = () => {
          reject(new Error('图片加载失败'));
        };

        // 设置图片源，触发加载
        image.src = dataURL;

      } catch (error) {
        reject(error);
      }
    });
  }
}
