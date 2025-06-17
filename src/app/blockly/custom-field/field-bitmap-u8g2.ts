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
const DEFAULT_PIXEL_SIZE = 2;
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

    // 添加输入框的引用作为类属性
    private widthInput: HTMLInputElement | null = null;
    private heightInput: HTMLInputElement | null = null;

    /**
     * Array holding info needed to unbind events.
     * Used for disposing.
     */
    private boundEvents: Blockly.browserEvents.Data[] = [];    /** References to UI elements */
    private editorCanvas: HTMLCanvasElement | null = null;
    private editorContext: CanvasRenderingContext2D | null = null;
    private blockDisplayImage: SVGImageElement | null = null;    /** Stateful variables */
    private pointerIsDown = false; private valToPaintWith?: number;
    private lastPaintedRow: number = -1;
    private lastPaintedCol: number = -1;
    private pendingUpdates: Set<string> = new Set();
    private updateTimer: number | null = null;
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
     */
    constructor(
        value: number[][] | typeof Blockly.Field.SKIP_SETUP,
        validator?: Blockly.FieldValidator<number[][]>,
        config?: FieldBitmapFromJsonConfig,
    ) {
        super(value, validator, config); this.SERIALIZABLE = true;
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
    }

    /**
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
            'dropdownEditor-u8g2',); if (this.buttonOptions.clear || this.buttonOptions.upload) {
                dropdownEditor.classList.add('has-buttons-u8g2');
            }

        // 创建Canvas编辑器
        const canvasContainer = this.createElementWithClassname(
            'div',
            'canvasContainer-u8g2',
        );
        this.editorCanvas = document.createElement('canvas');
        this.editorCanvas.className = 'bitmapCanvas-u8g2';
        this.editorCanvas.width = this.imgWidth * this.pixelSize;
        this.editorCanvas.height = this.imgHeight * this.pixelSize;

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
        this.renderCanvasEditor();        // Add control buttons below the canvas
        if (this.buttonOptions.clear || this.buttonOptions.upload) {
            const buttonContainer = this.createElementWithClassname('div', 'buttonContainer-u8g2');

            // Add width and height input controls
            this.addDimensionControls(buttonContainer);

            if (this.buttonOptions.upload) {
                this.addControlButton(
                    buttonContainer,
                    Blockly.Msg['BUTTON_LABEL_UPLOAD'],
                    this.uploadBitmap,
                );
            }
            if (this.buttonOptions.clear) {
                this.addControlButton(
                    buttonContainer,
                    Blockly.Msg['BUTTON_LABEL_CLEAR'],
                    this.clearPixels,
                );
            }

            dropdownEditor.appendChild(buttonContainer);
        }

        // Store the initial value at the start of the edit.
        this.initialValue = this.getValue();

        return dropdownEditor;
    }

    /**
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

            // Update the block display image size
            if (this.blockDisplayImage) {
                this.blockDisplayImage.setAttribute('width', String(newWidth));
                this.blockDisplayImage.setAttribute('height', String(newHeight));
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
     */    private addControlButton(
        parent: HTMLElement,
        buttonText: string,
        onClick: () => void,) {
        const button = this.createElementWithClassname('button', 'controlButton-u8g2');
        button.innerText = buttonText;
        parent.appendChild(button);
        this.bindEvent(button, 'click', onClick);
    }

    /**
     * 添加宽度和高度的尺寸控制输入框。
     *
     * @param parent 将添加尺寸控制的父HTML元素。
     */
    private addDimensionControls(parent: HTMLElement) {
        const dimensionContainer = this.createElementWithClassname('div', 'dimensionContainer-u8g2');

        // Width input
        const widthLabel = document.createElement('label');
        widthLabel.textContent = 'W';
        widthLabel.className = 'dimensionLabel-u8g2';
        dimensionContainer.appendChild(widthLabel);

        // 将局部变量改为类属性
        this.widthInput = document.createElement('input');
        this.widthInput.type = 'number';
        this.widthInput.min = '1';
        this.widthInput.max = '256';
        this.widthInput.value = this.imgWidth.toString();
        this.widthInput.className = 'dimensionInput-u8g2';
        dimensionContainer.appendChild(this.widthInput);

        // Height input
        const heightLabel = document.createElement('label');
        heightLabel.textContent = 'H';
        heightLabel.className = 'dimensionLabel-u8g2';
        dimensionContainer.appendChild(heightLabel);

        // 将局部变量改为类属性
        this.heightInput = document.createElement('input');
        this.heightInput.type = 'number';
        this.heightInput.min = '1';
        this.heightInput.max = '128';
        this.heightInput.value = this.imgHeight.toString();
        this.heightInput.className = 'dimensionInput-u8g2';
        dimensionContainer.appendChild(this.heightInput);

        // Apply button
        const applyButton = this.createElementWithClassname('button', 'controlButton-u8g2');
        applyButton.innerText = 'Apply';
        dimensionContainer.appendChild(applyButton);

        // Event handlers - 使用类属性
        this.bindEvent(applyButton, 'click', () => {
            if (this.widthInput && this.heightInput) {
                const newWidth = parseInt(this.widthInput.value, 10);
                const newHeight = parseInt(this.heightInput.value, 10);

                if (newWidth > 0 && newHeight > 0 && newWidth <= 128 && newHeight <= 128) {
                    this.resizeBitmap(newWidth, newHeight);
                }
            }
        });

        parent.appendChild(dimensionContainer);
    }

    /**
     * Resize the bitmap to new dimensions.
     *
     * @param newWidth New width in pixels.
     * @param newHeight New height in pixels.
     */
    private resizeBitmap(newWidth: number, newHeight: number) {
        const currentValue = this.getValue();
        if (!currentValue) return;

        // Create new bitmap with new dimensions
        const newBitmap: number[][] = [];
        for (let r = 0; r < newHeight; r++) {
            newBitmap.push([]);
            for (let c = 0; c < newWidth; c++) {
                // Copy existing pixel if within bounds, otherwise fill with 0
                if (r < this.imgHeight && c < this.imgWidth) {
                    newBitmap[r].push(currentValue[r][c]);
                } else {
                    newBitmap[r].push(0);
                }
            }
        }

        // Update dimensions
        this.imgWidth = newWidth;
        this.imgHeight = newHeight;

        // Update pixel size if field height is fixed
        if (this.fieldHeight) {
            this.pixelSize = this.fieldHeight / this.imgHeight;
        }

        // Update canvas size
        if (this.editorCanvas) {
            this.editorCanvas.width = this.imgWidth * this.pixelSize;
            this.editorCanvas.height = this.imgHeight * this.pixelSize;
        }        // Set new value
        this.setValue(newBitmap);
        this.fireIntermediateChangeEvent(newBitmap);

        // Re-render everything
        if (this.editorCanvas && this.editorContext) {
            this.renderCanvasEditor();
        }
        this.updateBlockDisplayImage();
        this.updateSize_();

        // Force a complete re-render of the field
        this.render_();
    }
    
    /**
     * Disposes of events belonging to the bitmap editor.
     */
    private dropdownDispose() {
        // 清理定时器
        if (this.updateTimer !== null) {
            clearTimeout(this.updateTimer);
            this.updateTimer = null;
        }

        // 确保所有待更新的内容都被应用
        this.flushPendingUpdates();

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
        this.pendingUpdates.clear();
        // Set this.initialValue back to null.
        this.initialValue = null;

        // 清理输入框引用
        this.widthInput = null;
        this.heightInput = null;

        Blockly.DropDownDiv.getContentDiv().classList.remove(
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

        const col = Math.floor(x / this.pixelSize);
        const row = Math.floor(y / this.pixelSize);

        if (row >= 0 && row < this.imgHeight && col >= 0 && col < this.imgWidth) {
            this.onPointerDownInPixel(row, col);
            this.lastPaintedRow = row;
            this.lastPaintedCol = col;
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

        const col = Math.floor(x / this.pixelSize);
        const row = Math.floor(y / this.pixelSize);

        if (row >= 0 && row < this.imgHeight && col >= 0 && col < this.imgWidth) {
            // 如果当前位置与上次绘制位置不同，绘制连续线条
            if (this.lastPaintedRow !== row || this.lastPaintedCol !== col) {
                this.drawLine(this.lastPaintedRow, this.lastPaintedCol, row, col);
                this.lastPaintedRow = row;
                this.lastPaintedCol = col;
            }
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
        this.setPixelBatch(r, c, newPixelValue);
        this.pointerIsDown = true;
        this.valToPaintWith = newPixelValue;

        // 立即刷新第一个点的更新
        this.flushPendingUpdates();
    }

    /**
     * Resets pointer state (e.g. After either a pointerup event or if the
     * gesture is canceled).
     */
    private onPointerEnd() {
        // 确保所有待更新的内容都被应用
        this.flushPendingUpdates();

        this.pointerIsDown = false;
        this.valToPaintWith = undefined;
        this.lastPaintedRow = -1;
        this.lastPaintedCol = -1;
    }

    /**
     * Sets all the pixels to 0.
     */
    private clearPixels() {
        const cleared = this.getEmptyArray();
        this.fireIntermediateChangeEvent(cleared);
        this.setValue(cleared, false);

        // 更新canvas显示
        if (this.editorCanvas && this.editorContext) {
            this.renderCanvasEditor();
        }

        // 更新block上的图片显示
        this.updateBlockDisplayImage();
    }/**
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
    }

    /**
     * Setup upload response handler
     */
    private setupUploadResponseHandler() {
        const uploadService = this.globalServiceManager.getBitmapUploadService();
        if (uploadService) {
            uploadService.uploadResponse$.subscribe(response => {
                console.log('field received:', response);
                if (response.success && response.data) {
                    let data = response.data;
                    if (data.bitmapArray) {
                        this.setValue(data.bitmapArray);
                    }
                    if (this.widthInput) {
                        this.widthInput.value = data.width.toString();
                    }
                    if (this.heightInput) {
                        this.heightInput.value = data.height.toString();
                    }

                    if (this.editorCanvas && this.editorContext) {
                        this.renderCanvasEditor();
                        this.resizeBitmap(data.width, data.height);
                    }
                } else {
                    console.error('Upload processing failed');
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
                const x = c * this.pixelSize;
                const y = r * this.pixelSize;
                // 绘制像素
                this.editorContext.fillStyle = bitmap[r][c] ? this.pixelColours.filled : this.pixelColours.empty;
                this.editorContext.fillRect(x, y, this.pixelSize, this.pixelSize);
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
    private hexToRgb(hex: string): { r: number, g: number, b: number } {
        const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
        return result ? {
            r: parseInt(result[1], 16),
            g: parseInt(result[2], 16),
            b: parseInt(result[3], 16)
        } : { r: 0, g: 0, b: 0 };
    }    /**
     * 使用布雷森汉姆直线算法在两个点之间绘制连续线条
     * @param r0 起始行
     * @param c0 起始列
     * @param r1 结束行
     * @param c1 结束列
     */
    private drawLine(r0: number, c0: number, r1: number, c1: number) {
        if (this.valToPaintWith === undefined) return;

        const dx = Math.abs(c1 - c0);
        const dy = Math.abs(r1 - r0);
        const sx = c0 < c1 ? 1 : -1;
        const sy = r0 < r1 ? 1 : -1;
        let err = dx - dy;

        let r = r0;
        let c = c0;

        while (true) {
            // 绘制当前点
            if (r >= 0 && r < this.imgHeight && c >= 0 && c < this.imgWidth) {
                if (this.getPixel(r, c) !== this.valToPaintWith) {
                    this.setPixelBatch(r, c, this.valToPaintWith);
                }
            }

            // 如果到达终点，退出循环
            if (r === r1 && c === c1) break;

            const e2 = 2 * err;
            if (e2 > -dy) {
                err -= dy;
                c += sx;
            }
            if (e2 < dx) {
                err += dx;
                r += sy;
            }
        }

        // 批量应用更新
        this.flushPendingUpdates();
    }

    /**
     * 批量设置像素值，提高性能
     * @param r Row number
     * @param c Column number  
     * @param newValue New pixel value
     */
    private setPixelBatch(r: number, c: number, newValue: number) {
        const currentValue = this.getValue();
        if (!currentValue) return;

        // 如果值没有改变，跳过
        if (currentValue[r][c] === newValue) return;

        // 记录待更新的像素
        const key = `${r},${c}`;
        this.pendingUpdates.add(key);

        // 立即更新数据
        currentValue[r][c] = newValue;
    }

    /**
     * 批量应用所有待更新的像素
     */
    private flushPendingUpdates() {
        if (this.pendingUpdates.size === 0) return;

        // 清除之前的定时器
        if (this.updateTimer !== null) {
            clearTimeout(this.updateTimer);
        }
        // 设置新的定时器，延迟更新以提高性能
        this.updateTimer = window.setTimeout(() => {
            const currentValue = this.getValue();
            if (currentValue) {
                // 触发中间变化事件
                this.fireIntermediateChangeEvent(currentValue);

                // 更新字段值
                this.setValue(currentValue, false);

                // 立即更新canvas显示
                if (this.editorCanvas && this.editorContext) {
                    this.renderCanvasEditor();
                }

                // 更新block上的图片显示
                this.updateBlockDisplayImage();
            }

            this.pendingUpdates.clear();
            this.updateTimer = null;
        }, 16); // 约60fps的更新频率
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
  padding-bottom: 5px;
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
  align-items: center;
  flex-wrap: wrap;
}
.dimensionContainer-u8g2 {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px;
  border-radius: 4px;
  border: 1px solid #ddd;
  background: #eee;
}
.dimensionLabel-u8g2 {
  font-size: 12px;
  color: #333;
  margin: 0;
  white-space: nowrap;
}
.dimensionInput-u8g2 {
  height: 25px;
  width: 45px;
  padding: 4px 0px;
  border: 1px solid #ccc;
  border-radius: 3px;
  font-size: 12px;
  text-align: center;
  color: #333;
}
.dimensionInput-u8g2:focus {
  outline: none;
  border-color: #007acc;
  box-shadow: 0 0 0 1px rgba(0, 122, 204, 0.3);

}
.controlButton-u8g2 {
  height: 25px;
  margin: 0;
  color: #333;
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