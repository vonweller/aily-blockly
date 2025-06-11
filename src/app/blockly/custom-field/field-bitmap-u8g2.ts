/**
 * @license
 * Copyright 2021 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import * as Blockly from 'blockly/core';
import { BitmapUploadRequest } from '../bitmap-upload.service';
import { GlobalServiceManager } from '../global-service-manager';

Blockly.Msg['BUTTON_LABEL_CLEAR'] = 'Clear';
Blockly.Msg['BUTTON_LABEL_UPLOAD'] = 'Upload';

export const DEFAULT_HEIGHT = 128;
export const DEFAULT_WIDTH = 64;
const DEFAULT_PIXEL_SIZE = 1.5;
const DEFAULT_PIXEL_COLOURS: PixelColours = {
    empty: '#fff',
    filled: '#363d80',
};
const DEFAULT_BUTTONS: Buttons = {
    upload: true,
    clear: true,
};
/**
 * Field for inputting a small bitmap image.
 * Includes a grid of clickable pixels that's exported as a bitmap.
 */
export class FieldBitmapU8g2 extends Blockly.Field<number[][]> {
    private initialValue: number[][] | null = null;
    private imgHeight: number;
    private imgWidth: number;
    private globalServiceManager: GlobalServiceManager;
    /**
     * Array holding info needed to unbind events.
     * Used for disposing.
     */
    private boundEvents: Blockly.browserEvents.Data[] = [];    /** References to UI elements */
    private editorCanvas: HTMLCanvasElement | null = null;
    private editorContext: CanvasRenderingContext2D | null = null;
    private blockDisplayImage: SVGImageElement | null = null;
    /** Stateful variables */
    private pointerIsDown = false;
    private valToPaintWith?: number;
    private canvasPixelSize = 8; // Canvas中每个像素的显示大小
    buttonOptions: Buttons;
    pixelSize: number;
    pixelColours: { empty: string; filled: string };
    fieldHeight?: number;

    /**
     * Constructor for the bitmap field.
     *
     * @param value 2D rectangular array of 1s and 0s.
     * @param validator A function that is called to validate.
     * @param config Config A map of options used to configure the field.
     */    constructor(
        value: number[][] | typeof Blockly.Field.SKIP_SETUP,
        validator?: Blockly.FieldValidator<number[][]>,
        config?: FieldBitmapFromJsonConfig,
    ) {
        super(value, validator, config);        this.SERIALIZABLE = true;
        // this.CURSOR = 'default';
        this.buttonOptions = { ...DEFAULT_BUTTONS, ...config?.buttons };
        this.pixelColours = { ...DEFAULT_PIXEL_COLOURS, ...config?.colours };
          // Initialize global service manager
        this.globalServiceManager = GlobalServiceManager.getInstance();
        
        // Subscribe to upload responses
        this.setupUploadResponseHandler();

        // Configure value, height, and width
        const currentValue = this.getValue();
        if (currentValue !== null) {
            this.imgHeight = currentValue.length;
            this.imgWidth = currentValue[0].length || 0;
        } else {
            this.imgHeight = config?.height ?? DEFAULT_HEIGHT;
            this.imgWidth = config?.width ?? DEFAULT_WIDTH;
            // Set a default empty value
            this.setValue(this.getEmptyArray());
        }
        this.fieldHeight = config?.fieldHeight;
        if (this.fieldHeight) {
            this.pixelSize = this.fieldHeight / this.imgHeight;
        } else {
            this.pixelSize = DEFAULT_PIXEL_SIZE;
        }
    }

    /**
     * Constructs a FieldBitmap from a JSON arg object.
     *
     * @param options A JSON object with options.
     * @returns The new field instance.
     */
    static override fromJson(options: FieldBitmapFromJsonConfig) {
        // `this` might be a subclass of FieldBitmap if that class doesn't override the static fromJson method.
        return new this(
            options.value ?? Blockly.Field.SKIP_SETUP,
            undefined,
            options,
        );
    }

    /**
     * Returns the width of the image in pixels.
     *
     * @returns The width in pixels.
     */
    getImageWidth() {
        return this.imgWidth;
    }

    /**
     * Returns the height of the image in pixels.
     *
     * @returns The height in pixels.
     */
    getImageHeight() {
        return this.imgHeight;
    }

    /**
     * Validates that a new value meets the requirements for a valid bitmap array.
     *
     * @param newValue The new value to be tested.
     * @returns The new value if it's valid, or null.
     */
    // eslint-disable-next-line @typescript-eslint/naming-convention
    protected override doClassValidation_(
        newValue: number[][],
    ): number[][] | null | undefined;
    // eslint-disable-next-line @typescript-eslint/naming-convention
    protected override doClassValidation_(
        newValue?: number[][],
    ): number[][] | null;
    // eslint-disable-next-line @typescript-eslint/naming-convention
    protected override doClassValidation_(
        newValue?: number[][],
    ): number[][] | null | undefined {
        if (!newValue) {
            return null;
        }
        // Check if the new value is an array
        if (!Array.isArray(newValue)) {
            return null;
        }
        const newHeight = newValue.length;
        // The empty list is not an acceptable bitmap
        if (newHeight == 0) {
            return null;
        }

        // Check that the width matches the existing width of the image if it
        // already has a value.
        const newWidth = newValue[0].length;
        for (const row of newValue) {
            if (!Array.isArray(row)) {
                return null;
            }
            if (row.length !== newWidth) {
                return null;
            }
        }

        // Check if all contents of the arrays are either 0 or 1
        for (const row of newValue) {
            for (const cell of row) {
                if (cell !== 0 && cell !== 1) {
                    return null;
                }
            }
        }
        return newValue;
    }

    /**
     * Called when a new value has been validated and is about to be set.
     *
     * @param newValue The value that's about to be set.
     */
    // eslint-disable-next-line
    protected override doValueUpdate_(newValue: number[][]) {
        super.doValueUpdate_(newValue);
        if (newValue) {
            this.imgHeight = newValue.length;
            this.imgWidth = newValue[0] ? newValue[0].length : 0;
            // If the field height is static, adjust the pixel size to fit.
            if (this.fieldHeight) {
                this.pixelSize = this.fieldHeight / this.imgHeight;
            } else {
                this.pixelSize = DEFAULT_PIXEL_SIZE;
            }
        }
    }

    /**
     * Show the bitmap editor dialog.
     *
     * @param e Optional mouse event that triggered the field to open, or
     *    undefined if triggered programmatically.
     */
    // eslint-disable-next-line
    protected override showEditor_(e?: Event) {
        const editor = this.dropdownCreate();
        Blockly.DropDownDiv.getContentDiv().appendChild(editor);
        Blockly.DropDownDiv.showPositionedByField(
            this,
            this.dropdownDispose.bind(this),
        );
    }    /**
     * Updates the block display and editor dropdown when the field re-renders.
     */
    // eslint-disable-next-line
    protected override render_() {
        super.render_();

        if (!this.getValue()) {
            return;
        }

        // 更新block显示的图片
        if (this.blockDisplayImage) {
            this.updateBlockDisplayImage();
        }

        // 更新canvas编辑器（如果存在）
        if (this.editorCanvas && this.editorContext) {
            this.renderCanvasEditor();
        }
    }

    /**
     * Determines whether the field is editable.
     *
     * @returns True since it is always editable.
     */
    override updateEditable() {
        const editable = super.updateEditable();
        // Blockly.Field's implementation sets these classes as appropriate, but
        // since this field has no text they just mess up the rendering of the grid
        // lines.
        const svgRoot = this.getSvgRoot();
        if (svgRoot) {
            Blockly.utils.dom.removeClass(svgRoot, 'blocklyNonEditableText');
            Blockly.utils.dom.removeClass(svgRoot, 'blocklyEditableText');
        }
        return editable;
    }

    /**
     * Gets the rectangle built out of dimensions matching SVG's <g> element.
     *
     * @returns The newly created rectangle of same size as the SVG element.
     */
    override getScaledBBox() {
        const boundingBox = this.getSvgRoot()?.getBoundingClientRect();
        if (!boundingBox) {
            throw new Error('Tried to retrieve a bounding box without a rect');
        }
        return new Blockly.utils.Rect(
            boundingBox.top,
            boundingBox.bottom,
            boundingBox.left,
            boundingBox.right,
        );
    }    /**
     * Creates the bitmap editor and add event listeners.
     *
     * @returns The newly created dropdown menu.
     */    private dropdownCreate() {
        const dropdownEditor = this.createElementWithClassname(
            'div',
            'dropdownEditor-u8g2',        );        if (this.buttonOptions.clear || this.buttonOptions.upload) {
            dropdownEditor.classList.add('has-buttons-u8g2');
        }

        // 创建Canvas编辑器
        const canvasContainer = this.createElementWithClassname(
            'div',
            'canvasContainer-u8g2',
        );
        
        this.editorCanvas = document.createElement('canvas');
        this.editorCanvas.className = 'bitmapCanvas-u8g2';
        this.editorCanvas.width = this.imgWidth * this.canvasPixelSize;
        this.editorCanvas.height = this.imgHeight * this.canvasPixelSize;
        
        this.editorContext = this.editorCanvas.getContext('2d');
        if (!this.editorContext) {
            throw new Error('无法获取canvas 2d context');
        }

        canvasContainer.appendChild(this.editorCanvas);
        dropdownEditor.appendChild(canvasContainer);

        // This prevents the normal max-height from adding a scroll bar for large images.
        Blockly.DropDownDiv.getContentDiv().classList.add('contains-bitmap-editor-u8g2');

        // 绑定canvas事件
        this.bindCanvasEvents();

        // 渲染初始canvas内容
        this.renderCanvasEditor();

        // Add control buttons below the canvas
        if (this.buttonOptions.clear || this.buttonOptions.upload) {
            const buttonContainer = this.createElementWithClassname('div', 'buttonContainer-u8g2');
            
            if (this.buttonOptions.clear) {
                this.addControlButton(
                    buttonContainer,
                    Blockly.Msg['BUTTON_LABEL_CLEAR'],
                    this.clearPixels,
                );
            }

            if (this.buttonOptions.upload) {
                this.addControlButton(
                    buttonContainer,
                    Blockly.Msg['BUTTON_LABEL_UPLOAD'],
                    this.uploadBitmap,
                );
            }
            
            dropdownEditor.appendChild(buttonContainer);
        }

        // Store the initial value at the start of the edit.
        this.initialValue = this.getValue();

        return dropdownEditor;
    }    /**
     * Initializes the on-block display.
     */
    override initView() {
        // 创建SVG图片元素来显示bitmap
        this.blockDisplayImage = Blockly.utils.dom.createSvgElement(
            'image',
            {
                x: 0,
                y: 0,
                width: this.pixelSize * this.imgWidth,
                height: this.pixelSize * this.imgHeight,
            },
            this.getSvgRoot(),
        ) as SVGImageElement;

        // 初始渲染
        this.updateBlockDisplayImage();
    }

    /**
     * Updates the size of the block based on the size of the underlying image.
     */
    // eslint-disable-next-line
    protected override updateSize_() {
        {
            const newWidth = this.pixelSize * this.imgWidth;
            const newHeight = this.pixelSize * this.imgHeight;
            if (this.borderRect_) {
                this.borderRect_.setAttribute('width', String(newWidth));
                this.borderRect_.setAttribute('height', String(newHeight));
            }

            this.size_.width = newWidth;
            this.size_.height = newHeight;
        }
    }

    /**
     * Create control button.
     *
     * @param parent Parent HTML element to which control button will be added.
     * @param buttonText Text of the control button.
     * @param onClick Callback that will be attached to the control button.
     */
    private addControlButton(
        parent: HTMLElement,
        buttonText: string,
        onClick: () => void,    ) {
        const button = this.createElementWithClassname('button', 'controlButton-u8g2');
        button.innerText = buttonText;
        parent.appendChild(button);
        this.bindEvent(button, 'click', onClick);
    }    /**
     * Disposes of events belonging to the bitmap editor.
     */
    private dropdownDispose() {
        if (
            this.getSourceBlock() &&
            this.initialValue !== null &&
            this.initialValue !== this.getValue()
        ) {
            Blockly.Events.fire(
                new (Blockly.Events.get(Blockly.Events.BLOCK_CHANGE))(
                    this.sourceBlock_,
                    'field',
                    this.name || null,
                    this.initialValue,
                    this.getValue(),
                ),
            );
        }

        for (const event of this.boundEvents) {
            Blockly.browserEvents.unbind(event);
        }
        this.boundEvents.length = 0;
        this.editorCanvas = null;
        this.editorContext = null;
        // Set this.initialValue back to null.
        this.initialValue = null;        Blockly.DropDownDiv.getContentDiv().classList.remove(
            'contains-bitmap-editor-u8g2',
        );
    }

    /**
     * Constructs an array of zeros with the specified width and height.
     *
     * @returns The new value.
     */
    private getEmptyArray(): number[][] {
        const newVal: number[][] = [];
        for (let r = 0; r < this.imgHeight; r++) {
            newVal.push([]);
            for (let c = 0; c < this.imgWidth; c++) {
                newVal[r].push(0);
            }
        }
        return newVal;
    }    /**
     * Checks if a down event is on a pixel in this editor and if it is starts an
     * edit gesture.
     *
     * @param e The down event.
     */
    private onPointerStart(e: PointerEvent) {
        if (!this.editorCanvas) return;
        
        const rect = this.editorCanvas.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        
        const col = Math.floor(x / this.canvasPixelSize);
        const row = Math.floor(y / this.canvasPixelSize);
        
        if (row >= 0 && row < this.imgHeight && col >= 0 && col < this.imgWidth) {
            this.onPointerDownInPixel(row, col);
            this.pointerIsDown = true;
            e.preventDefault();
        }
    }

    /**
     * Updates the editor if we're in an edit gesture and the pointer is over a
     * pixel.
     *
     * @param e The move event.
     */
    private onPointerMove(e: PointerEvent) {
        if (!this.pointerIsDown || !this.editorCanvas) {
            return;
        }
        
        const rect = this.editorCanvas.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        
        const col = Math.floor(x / this.canvasPixelSize);
        const row = Math.floor(y / this.canvasPixelSize);
        
        if (row >= 0 && row < this.imgHeight && col >= 0 && col < this.imgWidth) {
            this.updatePixelValue(row, col);
        }
        e.preventDefault();
    }

    /**
     * Starts an interaction with the bitmap dropdown when there's a pointerdown
     * within one of the pixels in the editor.
     *
     * @param r Row number of grid.
     * @param c Column number of grid.
     */
    private onPointerDownInPixel(r: number, c: number) {
        // Toggle that pixel to the opposite of its value
        const newPixelValue = 1 - this.getPixel(r, c);
        this.setPixel(r, c, newPixelValue);
        this.pointerIsDown = true;
        this.valToPaintWith = newPixelValue;
    }

    /**
     * Sets the specified pixel in the editor to the current value being painted.
     *
     * @param r Row number of grid.
     * @param c Column number of grid.
     */
    private updatePixelValue(r: number, c: number) {
        if (
            this.valToPaintWith !== undefined &&
            this.getPixel(r, c) !== this.valToPaintWith
        ) {
            this.setPixel(r, c, this.valToPaintWith);
        }
    }

    /**
     * Resets pointer state (e.g. After either a pointerup event or if the
     * gesture is canceled).
     */
    private onPointerEnd() {
        this.pointerIsDown = false;
        this.valToPaintWith = undefined;
    }    /**
     * Sets all the pixels to 0.
     */
    private clearPixels() {
        const cleared = this.getEmptyArray();
        this.fireIntermediateChangeEvent(cleared);
        this.setValue(cleared, false);
    }    /**
     * Upload current bitmap to Angular main program for processing.
     */
    private uploadBitmap() {
        const currentBitmap = this.getValue();
        if (!currentBitmap) {
            console.error('No bitmap data to upload');
            return;
        }

        const uploadRequest: BitmapUploadRequest = {
            currentBitmap: currentBitmap,
            width: this.imgWidth,
            height: this.imgHeight,
            timestamp: Date.now()
        };

        // Get upload service through global service manager
        const uploadService = this.globalServiceManager.getBitmapUploadService();
        if (uploadService) {
            uploadService.sendUploadRequest(uploadRequest);
            // console.log('Bitmap upload request sent:', uploadRequest);
        } else {
            console.error('BitmapUploadService not available');
        }
    }    /**
     * Setup upload response handler
     */
    private setupUploadResponseHandler() {
        const uploadService = this.globalServiceManager.getBitmapUploadService();
        if (uploadService) {
            uploadService.uploadResponse$.subscribe(response => {
                if (response.success && response.processedBitmap) {
                    console.log('Received processed bitmap:', response);
                    
                    // 验证处理后的bitmap数据尺寸是否正确
                    if (response.processedBitmap.length === this.imgHeight &&
                        response.processedBitmap[0] && 
                        response.processedBitmap[0].length === this.imgWidth) {
                        
                        // 更新字段值
                        this.setValue(response.processedBitmap);
                        
                        // 触发中间变化事件
                        this.fireIntermediateChangeEvent(response.processedBitmap);
                          // 如果编辑器已打开，更新编辑器显示
                        if (this.editorCanvas && this.editorContext) {
                            this.renderCanvasEditor();
                        }
                        
                        // 更新块显示
                        this.render_();
                        
                        console.log('Bitmap field updated successfully');
                    } else {
                        console.error('Processed bitmap dimensions do not match field dimensions');
                    }
                } else {
                    console.error('Upload processing failed:', response.message);
                }
            });
        } else {
            console.warn('BitmapUploadService not available for response handling');
        }
    }

    /**
     * Sets the value of a particular pixel.
     *
     * @param r Row number of grid.
     * @param c Column number of grid.
     * @param newValue Value of the pixel.
     */
    private setPixel(r: number, c: number, newValue: number) {
        const newGrid = JSON.parse(JSON.stringify(this.getValue()));
        newGrid[r][c] = newValue;
        this.fireIntermediateChangeEvent(newGrid);
        this.setValue(newGrid, false);
    }

    private getPixel(row: number, column: number): number {
        const value = this.getValue();
        if (!value) {
            throw new Error(
                'Attempted to retrieve a pixel value when no value is set',
            );
        }

        return value[row][column];
    }

    /**
     * Calls a given function for all cells in the image, with the cell
     * coordinates as the arguments.
     *
     * @param func A function to be applied.
     */
    private forAllCells(func: (row: number, col: number) => void) {
        for (let r = 0; r < this.imgHeight; r++) {
            for (let c = 0; c < this.imgWidth; c++) {
                func(r, c);
            }
        }
    }

    /**
     * Creates a new element with the specified type and class.
     *
     * @param elementType Type of html element.
     * @param className ClassName of html element.
     * @returns The created element.
     */
    private createElementWithClassname(elementType: string, className: string) {
        const newElt = document.createElement(elementType);
        newElt.className = className;
        return newElt;
    }

    /**
     * Binds an event listener to the specified element.
     *
     * @param element Specified element.
     * @param eventName Name of the event to bind.
     * @param callback Function to be called on specified event.
     */
    private bindEvent(
        element: HTMLElement,
        eventName: string,
        callback: (e: PointerEvent) => void,
    ) {
        this.boundEvents.push(
            Blockly.browserEvents.bind(element, eventName, this, callback),
        );
    }

    private fireIntermediateChangeEvent(newValue: number[][]) {
        if (this.getSourceBlock()) {
            Blockly.Events.fire(
                new (Blockly.Events.get(
                    Blockly.Events.BLOCK_FIELD_INTERMEDIATE_CHANGE,
                ))(this.getSourceBlock(), this.name || null, this.getValue(), newValue),
            );
        }
    }

    /**
     * 更新block显示的图片
     */
    private updateBlockDisplayImage() {
        if (!this.blockDisplayImage) return;
        
        const bitmap = this.getValue();
        if (!bitmap) return;
        
        // 创建canvas来生成图片数据
        const canvas = document.createElement('canvas');
        canvas.width = this.imgWidth;
        canvas.height = this.imgHeight;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        
        // 绘制bitmap到canvas
        const imageData = ctx.createImageData(this.imgWidth, this.imgHeight);
        for (let r = 0; r < this.imgHeight; r++) {
            for (let c = 0; c < this.imgWidth; c++) {
                const pixelIndex = (r * this.imgWidth + c) * 4;
                const isOn = bitmap[r][c];
                if (isOn) {
                    // 转换颜色字符串为RGB值
                    const color = this.hexToRgb(this.pixelColours.filled);
                    imageData.data[pixelIndex] = color.r;     // R
                    imageData.data[pixelIndex + 1] = color.g; // G
                    imageData.data[pixelIndex + 2] = color.b; // B
                } else {
                    const color = this.hexToRgb(this.pixelColours.empty);
                    imageData.data[pixelIndex] = color.r;     // R
                    imageData.data[pixelIndex + 1] = color.g; // G
                    imageData.data[pixelIndex + 2] = color.b; // B
                }
                imageData.data[pixelIndex + 3] = 255; // A
            }
        }
        
        ctx.putImageData(imageData, 0, 0);
        
        // 将canvas转换为data URL并设置到SVG image元素
        const dataUrl = canvas.toDataURL();
        this.blockDisplayImage.setAttributeNS('http://www.w3.org/1999/xlink', 'href', dataUrl);
    }
    
    /**
     * 渲染canvas编辑器
     */
    private renderCanvasEditor() {
        if (!this.editorContext || !this.editorCanvas) return;
        
        const bitmap = this.getValue();
        if (!bitmap) return;
        
        // 清除canvas
        this.editorContext.clearRect(0, 0, this.editorCanvas.width, this.editorCanvas.height);
        
        // 绘制网格和像素
        for (let r = 0; r < this.imgHeight; r++) {
            for (let c = 0; c < this.imgWidth; c++) {
                const x = c * this.canvasPixelSize;
                const y = r * this.canvasPixelSize;
                
                // 绘制像素
                this.editorContext.fillStyle = bitmap[r][c] ? 
                    this.pixelColours.filled : this.pixelColours.empty;
                this.editorContext.fillRect(x, y, this.canvasPixelSize, this.canvasPixelSize);
                
                // 绘制网格线
                this.editorContext.strokeStyle = '#ccc';
                this.editorContext.lineWidth = 1;
                this.editorContext.strokeRect(x, y, this.canvasPixelSize, this.canvasPixelSize);
            }
        }
    }
    
    /**
     * 绑定canvas事件
     */
    private bindCanvasEvents() {
        if (!this.editorCanvas) return;
        
        this.bindEvent(this.editorCanvas, 'pointermove', this.onPointerMove);
        this.bindEvent(this.editorCanvas, 'pointerup', this.onPointerEnd);
        this.bindEvent(this.editorCanvas, 'pointerleave', this.onPointerEnd);
        this.bindEvent(this.editorCanvas, 'pointerdown', this.onPointerStart);
        this.bindEvent(this.editorCanvas, 'pointercancel', this.onPointerEnd);
        
        // 防止触摸事件的默认行为
        this.bindEvent(this.editorCanvas, 'touchmove', (e: Event) => {
            e.preventDefault();
        });
    }
    
    /**
     * 将十六进制颜色转换为RGB
     */
    private hexToRgb(hex: string): {r: number, g: number, b: number} {
        const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
        return result ? {
            r: parseInt(result[1], 16),
            g: parseInt(result[2], 16),
            b: parseInt(result[3], 16)
        } : {r: 0, g: 0, b: 0};
    }
}

interface Buttons {
    readonly upload: boolean;
    readonly clear: boolean;
}
interface PixelColours {
    readonly empty: string;
    readonly filled: string;
}

export interface FieldBitmapFromJsonConfig extends Blockly.FieldConfig {
    value?: number[][];
    width?: number;
    height?: number;
    buttons?: Buttons;
    fieldHeight?: number;
    colours?: PixelColours;
}

Blockly.fieldRegistry.register('field_bitmap_u8g2', FieldBitmapU8g2);

/**
 * CSS for bitmap field.
 */
Blockly.Css.register(`
.dropdownEditor-u8g2 {
  align-items: center;
  flex-direction: column;
  display: flex;
  justify-content: center;
}
.dropdownEditor-u8g2.has-buttons-u8g2 {
  padding-bottom: 10px;
}
.canvasContainer-u8g2 {
  border: 2px solid #333;
  margin: 10px;
  display: inline-block;
}
.bitmapCanvas-u8g2 {
  display: block;
  cursor: crosshair;
}
.pixelDisplay-u8g2 {
  white-space:pre-wrap;
}
.buttonContainer-u8g2 {
  display: flex;
  flex-direction: row;
  gap: 8px;
  margin-top: 10px;
}
.controlButton-u8g2 {
  margin: 0;
  color: #333;
  padding: 6px 12px;
  border: 1px solid #ccc;
  border-radius: 4px;
  background: #fff;
  cursor: pointer;
  font-size: 12px;
}
.controlButton-u8g2:hover {
  background: #f5f5f5;
  border-color: #999;
}
.blocklyDropDownContent.contains-bitmap-editor-u8g2 {
  max-height: none;
}
`);