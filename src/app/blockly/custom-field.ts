import * as Blockly from 'blockly/core';

/**
 * 自定义图片选择器字段类
 */
export class FieldImageSelector extends Blockly.FieldImage {
  // 默认图片和尺寸
  private static DEFAULT_IMAGE = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAADIAAAAyCAYAAAAeP4ixAAAABmJLR0QA/wD/AP+gvaeTAAAACXBIWXMAAAsTAAALEwEAmpwYAAAAB3RJTUUH4QQECCEZVtqRkgAAAB1pVFh0Q29tbWVudAAAAAAAQ3JlYXRlZCB3aXRoIEdJTVBkLmUHAAABJUlEQVRo3u2aTQrCMBCFP0UX7qUHEHoBV26EHsWDeAYP4ELow4V0Kfmh0ymZJDMJfLBoCfMy82YSGjhw4KfRAb1z3AEPQICkkTEDl9L3HnAHHKUOlmQEmZHOFjgZpMrQlsw18GYZkPRkO2BvlHLCKFdmZZTIClOkzK3R6ESYvDILxR+9kvwiZa4CekiVySpzEtJDQ5kk+UVlbkJ6aC0zfckIZe5CemgtE19lWun/aO38NRAPedUw0EqGChs7m1WjWBm16FsrE1VGM/pWykSV0Y6+tjKrymhHX1OZqDIW0ddSZlUZi+hrKBNVxir6NYuNqjJW0a9ZbJaVsYx+rWLTWEa/RrGpKmMd/VrFJlELPanYJGqh5/pNaa7/jAMHDvwlfgBUhYATgKrGTQAAAABJRU5ErkGggg==';
  private static DEFAULT_WIDTH = 64;
  private static DEFAULT_HEIGHT = 64;

  // 存储图片数据
  private imageData: string;

  /**
   * 构造函数
   */
  constructor(value?: string, validator?: Blockly.FieldValidator<string>) {
    const src = value || FieldImageSelector.DEFAULT_IMAGE;
    
    super(
      src,
      FieldImageSelector.DEFAULT_WIDTH,
      FieldImageSelector.DEFAULT_HEIGHT,
      '点击选择图片',  // 鼠标悬停提示
      (field) => {
        // 点击时的回调函数
        (field as FieldImageSelector).openFilePicker();
      }
    );
    
    this.imageData = src;
    
    // 添加验证器
    if (validator) {
      this.setValidator(validator);
    }
  }

  /**
   * 从JSON创建字段实例
   */
  static override fromJson(options: any): FieldImageSelector {
    return new FieldImageSelector(options['src']);
  }

  /**
   * 初始化UI
   */
  public override initView() {
    super.initView();
    if (this.getClickTarget_()) {
      (this.getClickTarget_() as HTMLElement).style.cursor = 'pointer';
    }
  }

  /**
   * 打开文件选择器
   */
  openFilePicker() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.addEventListener('change', (event) => {
      const target = event.target as HTMLInputElement;
      if (target.files && target.files[0]) {
        this.handleImageSelection(target.files[0]);
      }
    });
    input.click();
  }

  /**
   * 处理选择的图片
   */
  private handleImageSelection(file: File) {
    const reader = new FileReader();
    reader.onload = (event) => {
      const imageData = event.target?.result as string;
      this.resizeImage(imageData).then(resizedImage => {
        this.setValue(resizedImage);
        this.imageData = resizedImage;
        
        // 触发变更事件
        if (this.sourceBlock_ && this.sourceBlock_.workspace) {
          Blockly.Events.fire(new Blockly.Events.BlockChange(
            this.sourceBlock_, 'field', this.name, this.value_, this.imageData));
        }
      });
    };
    reader.readAsDataURL(file);
  }

  /**
   * 调整图片尺寸
   */
  private async resizeImage(dataUrl: string): Promise<string> {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        
        canvas.width = FieldImageSelector.DEFAULT_WIDTH;
        canvas.height = FieldImageSelector.DEFAULT_HEIGHT;
        
        if (ctx) {
          ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
          resolve(canvas.toDataURL('image/png'));
        } else {
          resolve(dataUrl); // 如果无法获取上下文，返回原图
        }
      };
      img.src = dataUrl;
    });
  }

  /**
   * 获取序列化值
   */
  override saveState(): unknown {
    return this.imageData;
  }

  /**
   * 获取字段值
   */
  override getValue(): string {
    return this.imageData;
  }

  /**
   * 设置字段值
   */
  override setValue(newValue: string): void {
    if (newValue === null || newValue === this.imageData) {
      return;
    }
    
    const oldValue = this.imageData;
    this.imageData = newValue;
    
    if (this.imageElement) {
      this.imageElement.setAttribute('src', newValue);
    }
    
    // 触发变更事件
    if (this.sourceBlock_ && Blockly.Events.isEnabled()) {
      Blockly.Events.fire(new Blockly.Events.BlockChange(
        this.sourceBlock_, 'field', this.name, oldValue, newValue));
    }
  }

  /**
   * 获取可序列化的值
   */
  override toXml(fieldElement: Element): Element {
    fieldElement.setAttribute('src', this.imageData);
    return fieldElement;
  }

  /**
   * 从XML恢复状态
   */
  override fromXml(fieldElement: Element): void {
    const src = fieldElement.getAttribute('src');
    if (src) {
      this.setValue(src);
    }
  }
}

// 注册自定义字段
Blockly.fieldRegistry.register('field_image_selector', FieldImageSelector);