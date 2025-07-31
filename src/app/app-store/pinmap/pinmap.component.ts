import { Component, Inject, OnDestroy } from '@angular/core';
import { NZ_MODAL_DATA } from 'ng-zorro-antd/modal';

@Component({
  selector: 'app-pinmap',
  imports: [],
  templateUrl: './pinmap.component.html',
  styleUrl: './pinmap.component.scss'
})
export class PinmapComponent implements OnDestroy {
  img: string;
  
  // 缩放和拖拽相关属性
  scale = 1;
  translateX = 0;
  translateY = 0;
  
  // 拖拽状态
  isDragging = false;
  dragStartX = 0;
  dragStartY = 0;
  lastTranslateX = 0;
  lastTranslateY = 0;
  
  // 图片尺寸
  imageWidth = 0;
  imageHeight = 0;
  
  // 缩放参数
  readonly MIN_SCALE = 0.1;
  readonly MAX_SCALE = 5;
  readonly SCALE_STEP = 0.1;

  constructor(@Inject(NZ_MODAL_DATA) public data: { img: string }) {
    this.img = data.img;
  }

  ngOnDestroy(): void {
    // 清理全局事件监听器，防止内存泄漏
    document.removeEventListener('mousemove', this.onDocumentMouseMove);
    document.removeEventListener('mouseup', this.onDocumentMouseUp);
    document.body.style.userSelect = '';
  }

  // 图片加载完成
  onImageLoad(event: Event): void {
    const img = event.target as HTMLImageElement;
    this.imageWidth = img.naturalWidth;
    this.imageHeight = img.naturalHeight;
  }

  // 鼠标滚轮缩放
  onWheel(event: WheelEvent): void {
    event.preventDefault();
    
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    const mouseX = event.clientX - rect.left;
    const mouseY = event.clientY - rect.top;
    
    const delta = event.deltaY > 0 ? -this.SCALE_STEP : this.SCALE_STEP;
    const newScale = Math.max(this.MIN_SCALE, Math.min(this.MAX_SCALE, this.scale + delta));
    
    if (newScale !== this.scale) {
      // 以鼠标位置为中心缩放
      const scaleRatio = newScale / this.scale;
      this.translateX = mouseX - (mouseX - this.translateX) * scaleRatio;
      this.translateY = mouseY - (mouseY - this.translateY) * scaleRatio;
      this.scale = newScale;
    }
  }

  // 鼠标按下开始拖拽
  onMouseDown(event: MouseEvent): void {
    if (event.button === 0) { // 左键
      this.isDragging = true;
      this.dragStartX = event.clientX;
      this.dragStartY = event.clientY;
      this.lastTranslateX = this.translateX;
      this.lastTranslateY = this.translateY;
      
      // 防止文本选择
      event.preventDefault();
      document.body.style.userSelect = 'none';
      
      // 添加全局鼠标事件监听，确保在整个窗口范围内都能拖拽
      document.addEventListener('mousemove', this.onDocumentMouseMove);
      document.addEventListener('mouseup', this.onDocumentMouseUp);
    }
  }

  // 全局鼠标移动事件
  onDocumentMouseMove = (event: MouseEvent): void => {
    if (this.isDragging) {
      const deltaX = event.clientX - this.dragStartX;
      const deltaY = event.clientY - this.dragStartY;
      
      this.translateX = this.lastTranslateX + deltaX;
      this.translateY = this.lastTranslateY + deltaY;
    }
  }

  // 全局鼠标松开事件
  onDocumentMouseUp = (event: MouseEvent): void => {
    this.isDragging = false;
    document.body.style.userSelect = '';
    
    // 移除全局事件监听
    document.removeEventListener('mousemove', this.onDocumentMouseMove);
    document.removeEventListener('mouseup', this.onDocumentMouseUp);
  }

  // 放大
  zoomIn(): void {
    const newScale = Math.min(this.MAX_SCALE, this.scale + this.SCALE_STEP);
    if (newScale !== this.scale) {
      this.scale = newScale;
    }
  }

  // 缩小
  zoomOut(): void {
    const newScale = Math.max(this.MIN_SCALE, this.scale - this.SCALE_STEP);
    if (newScale !== this.scale) {
      this.scale = newScale;
    }
  }

  // 重置视图
  resetView(): void {
    this.scale = 1;
    this.translateX = 0;
    this.translateY = 0;
  }

  // 获取变换样式
  getTransform(): string {
    return `translate(${this.translateX}px, ${this.translateY}px) scale(${this.scale})`;
  }
}
