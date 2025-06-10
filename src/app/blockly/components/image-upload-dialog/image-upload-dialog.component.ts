import { Component, OnInit, OnDestroy, Input, ViewChild, ElementRef, AfterViewInit } from '@angular/core';
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
export class ImageUploadDialogComponent implements AfterViewInit, OnDestroy {
  @Input() title = '上传图片';
  @ViewChild('cropperImage') cropperImage!: ElementRef<HTMLImageElement>;

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
    if (!this.cropper) {
      this.message.error('请先选择图片');
      return;
    }

    // 获取裁剪后的画布
    const canvas = this.cropper.getCroppedCanvas({
      width: 128,  // 固定输出宽度
      height: 64,  // 固定输出高度
      imageSmoothingEnabled: true,
      imageSmoothingQuality: 'high'
    });

    // 转换为 base64
    const croppedImageData = canvas.toDataURL('image/png');
      // 返回结果并关闭弹窗
    this.modal.close(croppedImageData);
  }

  onFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    if (input.files && input.files[0]) {
      this.handleFileSelect(input.files[0]);
    }
  }

  handleFileSelect(file: File): void {
    // 验证文件类型
    if (!file.type.startsWith('image/')) {
      this.message.error('请选择图片文件');
      return;
    }

    // 验证文件大小 (10MB)
    const maxSize = 10 * 1024 * 1024;
    if (file.size > maxSize) {
      this.message.error('图片大小不能超过 10MB');
      return;
    }

    const reader = new FileReader();
    reader.onload = (e) => {
      this.imageUrl = e.target?.result as string;
      // 等待下一个tick确保DOM更新完成
      setTimeout(() => {
        this.initCropper();
      }, 0);
    };
    reader.readAsDataURL(file);
  }

  initCropper() {
    if (!this.cropperImage?.nativeElement || !this.imageUrl) {
      return;
    }

    // 销毁已存在的cropper
    this.destroyCropper();

    const image = this.cropperImage.nativeElement;
    image.style.display = 'block';

    this.cropper = new Cropper(image, {
      aspectRatio: 2, // 固定长宽比 2:1 (128:64)
      viewMode: 1, // 限制裁剪框在画布内
      dragMode: 'move', // 设置为移动模式，移动图片而不是裁剪框
      cropBoxMovable: false, // 禁止移动裁剪框
      cropBoxResizable: false, // 禁止调整裁剪框大小
      toggleDragModeOnDblclick: false, // 禁止双击切换拖拽模式
      center: true, // 裁剪框居中
      highlight: false, // 禁用高亮
      background: true, // 显示网格背景
      autoCropArea: 0.8, // 初始裁剪区域为80%
      movable: true, // 允许移动图片
      rotatable: false, // 禁止旋转
      scalable: true, // 允许缩放
      zoomable: true, // 允许缩放
      zoomOnTouch: true, // 触摸缩放
      zoomOnWheel: true, // 滚轮缩放
      wheelZoomRatio: 0.1, // 滚轮缩放比例
      minCropBoxWidth: 100, // 最小裁剪框宽度
      minCropBoxHeight: 50, // 最小裁剪框高度
      ready: () => {
        // 裁剪器准备就绪后的回调
        console.log('Cropper ready');
      }
    });
  }

  destroyCropper() {
    if (this.cropper) {
      this.cropper.destroy();
      this.cropper = null;
    }
  }

  ngOnInit() {
    // Component initialization
  }

  ngAfterViewInit() {
    // 视图初始化完成后的逻辑
  }

  ngOnDestroy() {
    this.destroyCropper();
  }
}
