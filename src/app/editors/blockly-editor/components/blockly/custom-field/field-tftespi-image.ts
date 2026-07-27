import * as Blockly from 'blockly/core';
import { MEDIA_FIELD_PARAMETER_DEBOUNCE_MS } from './field-media-editor-style';

type ImageMessageParams = Record<string, string | number>;
type ImageTranslator = (key: string, params?: ImageMessageParams) => string;

const I18N_PREFIX = 'BLOCKLY.TFTESPI_IMAGE';
const MESSAGE_NAMES = [
  'BUTTON_UPLOAD',
  'UPLOAD_TOOLTIP',
  'BUTTON_CLEAR',
  'LABEL_WIDTH',
  'LABEL_HEIGHT',
  'LABEL_COLOR_MODE',
  'EMPTY',
  'STATUS_READING_FILE',
  'STATUS_SAVING_FILE',
  'STATUS_DECODING',
  'STATUS_REDECODING',
  'STATUS_INFO',
  'ERROR_FILE_SIZE_EXCEEDED',
  'ERROR_DECODE_FAILED',
  'ERROR_REDECODE_FAILED',
  'ERROR_PROJECT_PATH_MISSING',
  'ERROR_FS_CREATE_ASSETS_UNAVAILABLE',
  'ERROR_FS_SAVE_UNAVAILABLE',
  'ERROR_FS_READ_UNAVAILABLE',
  'ERROR_SOURCE_READ_INVALID',
  'ERROR_SOURCE_MISSING_REDECODE',
  'ERROR_SOURCE_NOT_FOUND',
  'ERROR_MD5_UNAVAILABLE',
  'ERROR_MD5_FAILED',
  'ERROR_UNSUPPORTED_FILE_TYPE',
] as const;

const DEFAULT_MESSAGES: Record<(typeof MESSAGE_NAMES)[number], string> = {
  BUTTON_UPLOAD: 'Upload',
  UPLOAD_TOOLTIP: 'Supported formats: PNG, JPEG, WebP, BMP',
  BUTTON_CLEAR: 'Clear',
  LABEL_WIDTH: 'W',
  LABEL_HEIGHT: 'H',
  LABEL_COLOR_MODE: 'Color',
  EMPTY: 'No image uploaded',
  STATUS_READING_FILE: 'Reading {{name}}...',
  STATUS_SAVING_FILE: 'Saving {{name}}...',
  STATUS_DECODING: 'Converting image...',
  STATUS_REDECODING: 'Re-converting {{name}}...',
  STATUS_INFO: '{{sourcePrefix}}{{width}}x{{height}} | {{mode}} | {{dataSize}}',
  ERROR_FILE_SIZE_EXCEEDED: 'Source file must not exceed {{maxSize}} (current: {{currentSize}})',
  ERROR_DECODE_FAILED: 'Image conversion failed',
  ERROR_REDECODE_FAILED: 'Image re-conversion failed',
  ERROR_PROJECT_PATH_MISSING: 'The current project path is unavailable, so the image source cannot be saved',
  ERROR_FS_CREATE_ASSETS_UNAVAILABLE: 'The image assets directory cannot be created',
  ERROR_FS_SAVE_UNAVAILABLE: 'The image source file cannot be saved',
  ERROR_FS_READ_UNAVAILABLE: 'The image source file cannot be read',
  ERROR_SOURCE_READ_INVALID: 'The image source file returned invalid data',
  ERROR_SOURCE_MISSING_REDECODE: 'The original image is unavailable for re-conversion',
  ERROR_SOURCE_NOT_FOUND: 'Image source not found: {{path}}',
  ERROR_MD5_UNAVAILABLE: 'The file hashing API is unavailable; restart the application and try again',
  ERROR_MD5_FAILED: 'Failed to hash the image source file',
  ERROR_UNSUPPORTED_FILE_TYPE: 'Only PNG, JPEG, WebP, and BMP images are supported',
};

let imageTranslator: ImageTranslator | null = null;

function interpolate(message: string, params?: ImageMessageParams) {
  if (!params) return message;
  return message.replace(/\{\{\s*(\w+)\s*\}\}/g, (match, key) => (
    Object.prototype.hasOwnProperty.call(params, key) ? String(params[key]) : match
  ));
}

function translateMessage(
  messageName: (typeof MESSAGE_NAMES)[number],
  params?: ImageMessageParams,
) {
  const translationKey = `${I18N_PREFIX}.${messageName}`;
  const translated = imageTranslator?.(translationKey, params);
  if (translated && translated !== translationKey) return translated;
  return interpolate(DEFAULT_MESSAGES[messageName], params);
}

function applyBlocklyMessages() {
  MESSAGE_NAMES.forEach((messageName) => {
    Blockly.Msg[`TFTESPI_IMAGE_${messageName}`] = translateMessage(messageName);
  });
}

export function setTftEsPiImageFieldTranslator(translator: ImageTranslator | null) {
  imageTranslator = translator;
  applyBlocklyMessages();
}

applyBlocklyMessages();

export type TftEsPiImageFormat = 'rgb565' | 'rgb332';
export type TftEsPiImageEncoding = 'rgb565-be-base64' | 'rgb332-base64';

export interface TftEsPiImageValue {
  version: 1;
  format: TftEsPiImageFormat;
  encoding: TftEsPiImageEncoding;
  width: number;
  height: number;
  data: string;
  sourceName?: string;
  sourceType?: string;
  sourcePath?: string;
}

interface ImageDecodeSource {
  fileName: string;
  mimeType: string;
  buffer: ArrayBuffer;
  sourcePath?: string;
}

export interface FieldTftEsPiImageFromJsonConfig extends Blockly.FieldConfig {
  value?: TftEsPiImageValue;
  width?: number;
  height?: number;
  format?: TftEsPiImageFormat;
  fieldHeight?: number;
}

const DEFAULT_WIDTH = 160;
const DEFAULT_HEIGHT = 120;
const DEFAULT_FORMAT: TftEsPiImageFormat = 'rgb565';
const MAX_WIDTH = 480;
const MAX_HEIGHT = 480;
const MAX_OUTPUT_BYTES = MAX_WIDTH * MAX_HEIGHT * 2;
const MAX_SOURCE_FILE_SIZE_BYTES = 20 * 1024 * 1024;
const DEFAULT_FIELD_HEIGHT = 50;

function normalizeImageFormat(
  value: unknown,
  fallback: TftEsPiImageFormat = DEFAULT_FORMAT,
): TftEsPiImageFormat {
  return value === 'rgb332' || value === 'rgb565' ? value : fallback;
}

function getImageEncoding(format: TftEsPiImageFormat): TftEsPiImageEncoding {
  return format === 'rgb332' ? 'rgb332-base64' : 'rgb565-be-base64';
}

function getImageByteLength(width: number, height: number, format: TftEsPiImageFormat) {
  return width * height * (format === 'rgb332' ? 1 : 2);
}

function bytesToBase64(bytes: Uint8Array) {
  let binary = '';
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
}

function base64ToBytes(base64: string) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index++) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

export class FieldTftEsPiImage extends Blockly.Field<TftEsPiImageValue> {
  private initialValue: TftEsPiImageValue | null = null;
  private imgWidth = DEFAULT_WIDTH;
  private imgHeight = DEFAULT_HEIGHT;
  private pixelFormat = DEFAULT_FORMAT;
  private readonly fieldHeight: number;
  private blockDisplayImage: SVGImageElement | null = null;
  private blockPreviewDataUrl = '';
  private previewCanvas: HTMLCanvasElement | null = null;
  private statusElement: HTMLElement | null = null;
  private fileInput: HTMLInputElement | null = null;
  private widthInput: HTMLInputElement | null = null;
  private heightInput: HTMLInputElement | null = null;
  private formatSelect: HTMLSelectElement | null = null;
  private settingsTimer: ReturnType<typeof setTimeout> | null = null;
  private sourceRedecodeTimer: ReturnType<typeof setTimeout> | null = null;
  private uploadRequestId = 0;
  private applyingDecodedValue = false;
  private isDisposed = false;
  private sourceBlockRenderScheduled = false;

  constructor(
    value: TftEsPiImageValue | typeof Blockly.Field.SKIP_SETUP,
    validator?: Blockly.FieldValidator<TftEsPiImageValue>,
    config?: FieldTftEsPiImageFromJsonConfig,
  ) {
    super(value, validator, config);
    this.SERIALIZABLE = true;
    this.fieldHeight = this.normalizeNumber(
      config?.fieldHeight,
      DEFAULT_FIELD_HEIGHT,
      16,
      200,
    );

    const normalized = this.normalizeValue(
      value === Blockly.Field.SKIP_SETUP ? config?.value : value,
      config,
    );
    this.syncSettings(normalized);
    if (value === Blockly.Field.SKIP_SETUP && !config?.value) this.setValue(normalized);
  }

  static override fromJson(options: FieldTftEsPiImageFromJsonConfig) {
    return new this(options.value ?? Blockly.Field.SKIP_SETUP, undefined, options);
  }

  protected override doClassValidation_(
    newValue?: TftEsPiImageValue,
  ): TftEsPiImageValue | null | undefined {
    if (!newValue || typeof newValue !== 'object') return null;
    return this.normalizeValue(newValue);
  }

  protected override doValueUpdate_(newValue: TftEsPiImageValue) {
    const dimensionsChanged = this.imgWidth !== newValue.width || this.imgHeight !== newValue.height;
    if (!this.applyingDecodedValue) {
      this.clearSettingsTimer();
      this.clearSourceRedecodeTimer();
      this.uploadRequestId += 1;
    }
    this.value_ = this.cloneValue(newValue);
    this.syncSettings(newValue);
    this.blockPreviewDataUrl = '';
    this.updateSize_();
    this.updateBlockDisplayImage();
    this.updateControlsFromValue();
    this.renderPreview();
    this.updateStatusFromValue();
    if (dimensionsChanged) this.rerenderSourceBlockAfterResize();
  }

  protected override showEditor_() {
    const editor = this.createDropdownEditor();
    const dropdownContent = Blockly.DropDownDiv.getContentDiv();
    dropdownContent.appendChild(editor);
    dropdownContent.classList.add('contains-tftespi-image-editor', 'ailyMediaFieldDropdown');
    Blockly.DropDownDiv.showPositionedByField(this, this.disposeDropdown.bind(this));
  }

  override initView() {
    this.blockDisplayImage = Blockly.utils.dom.createSvgElement(
      'image',
      {
        x: 0,
        y: 0,
        style: 'image-rendering: pixelated; cursor: pointer;',
      },
      this.getSvgRoot(),
    ) as SVGImageElement;
    this.updateSize_();
    this.updateBlockDisplayImage();
  }

  protected override render_() {
    super.render_();
    this.updateBlockDisplayImage();
  }

  override updateEditable() {
    const editable = super.updateEditable();
    const svgRoot = this.getSvgRoot();
    if (svgRoot) {
      Blockly.utils.dom.removeClass(svgRoot, 'blocklyNonEditableText');
      Blockly.utils.dom.removeClass(svgRoot, 'blocklyEditableText');
    }
    return editable;
  }

  protected override updateSize_() {
    const scale = this.fieldHeight / Math.max(1, this.imgHeight);
    const width = Math.max(1, this.imgWidth * scale);
    if (this.borderRect_) {
      this.borderRect_.setAttribute('width', String(width));
      this.borderRect_.setAttribute('height', String(this.fieldHeight));
    }
    if (this.blockDisplayImage) {
      this.blockDisplayImage.setAttribute('width', String(width));
      this.blockDisplayImage.setAttribute('height', String(this.fieldHeight));
    }
    this.size_.width = width;
    this.size_.height = this.fieldHeight;
  }

  override dispose() {
    this.isDisposed = true;
    this.uploadRequestId += 1;
    this.clearSettingsTimer();
    this.clearSourceRedecodeTimer();
    super.dispose();
  }

  private createDropdownEditor() {
    this.initialValue = this.cloneValue(this.getValue());
    const editor = this.createElement('div', 'tftEsPiImageEditor ailyMediaFieldEditor');
    editor.addEventListener('pointerdown', (event) => event.stopPropagation());

    const toolbar = this.createElement('div', 'tftEsPiImageToolbar ailyMediaFieldToolbar');
    const settings = this.createElement('div', 'tftEsPiImageSettings ailyMediaFieldSettings');
    this.widthInput = this.createNumberInput(this.imgWidth, 1, MAX_WIDTH);
    this.heightInput = this.createNumberInput(this.imgHeight, 1, MAX_HEIGHT);
    this.formatSelect = this.createFormatSelect(this.pixelFormat);
    settings.append(
      this.createNumberControl(Blockly.Msg['TFTESPI_IMAGE_LABEL_WIDTH'], this.widthInput),
      this.createNumberControl(Blockly.Msg['TFTESPI_IMAGE_LABEL_HEIGHT'], this.heightInput),
      this.createNumberControl(Blockly.Msg['TFTESPI_IMAGE_LABEL_COLOR_MODE'], this.formatSelect),
    );
    for (const input of [this.widthInput, this.heightInput]) {
      input.addEventListener('input', () => this.scheduleSettingsCommit());
      input.addEventListener('change', () => this.scheduleSettingsCommit());
      input.addEventListener('blur', () => this.scheduleSettingsCommit());
    }
    this.formatSelect.addEventListener('change', () => this.scheduleSettingsCommit());
    toolbar.appendChild(settings);

    const actions = this.createElement('div', 'tftEsPiImageActions ailyMediaFieldActions');
    this.fileInput = document.createElement('input');
    this.fileInput.type = 'file';
    this.fileInput.accept = 'image/png,image/jpeg,image/webp,image/bmp,.png,.jpg,.jpeg,.webp,.bmp';
    this.fileInput.hidden = true;
    this.fileInput.addEventListener('change', () => void this.onFileSelected());
    actions.append(
      this.fileInput,
      this.createButton(
        Blockly.Msg['TFTESPI_IMAGE_BUTTON_UPLOAD'],
        () => this.fileInput?.click(),
        Blockly.Msg['TFTESPI_IMAGE_UPLOAD_TOOLTIP'],
      ),
      this.createButton(
        Blockly.Msg['TFTESPI_IMAGE_BUTTON_CLEAR'],
        () => this.clearImage(),
      ),
    );
    toolbar.appendChild(actions);
    editor.appendChild(toolbar);

    this.statusElement = this.createElement('div', 'tftEsPiImageStatus ailyMediaFieldStatus');
    editor.appendChild(this.statusElement);
    const preview = this.createElement('div', 'tftEsPiImagePreview ailyMediaFieldSurface');
    this.previewCanvas = document.createElement('canvas');
    this.previewCanvas.className = 'tftEsPiImageCanvas';
    preview.appendChild(this.previewCanvas);
    editor.appendChild(preview);

    this.updateControlsFromValue();
    this.renderPreview();
    this.updateStatusFromValue();
    return editor;
  }

  private createNumberInput(value: number, min: number, max: number) {
    const input = document.createElement('input');
    input.type = 'number';
    input.value = String(value);
    input.min = String(min);
    input.max = String(max);
    input.step = '1';
    input.className = 'ailyMediaFieldInput';
    return input;
  }

  private createFormatSelect(value: TftEsPiImageFormat) {
    const select = document.createElement('select');
    for (const format of ['rgb565', 'rgb332'] as const) {
      const option = document.createElement('option');
      option.value = format;
      option.textContent = format.toUpperCase();
      select.appendChild(option);
    }
    select.value = value;
    select.className = 'ailyMediaFieldInput';
    return select;
  }

  private createNumberControl(label: string, input: HTMLElement) {
    const wrapper = this.createElement('label', 'tftEsPiImageNumberControl ailyMediaFieldControl');
    const labelElement = document.createElement('span');
    labelElement.textContent = label;
    wrapper.append(labelElement, input);
    return wrapper;
  }

  private createButton(text: string, callback: () => void, title?: string) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'tftEsPiImageButton ailyMediaFieldButton';
    button.textContent = text;
    if (title) button.title = title;
    button.addEventListener('click', callback);
    return button;
  }

  private scheduleSettingsCommit() {
    this.clearSettingsTimer();
    this.settingsTimer = setTimeout(
      () => this.commitSettings(),
      MEDIA_FIELD_PARAMETER_DEBOUNCE_MS,
    );
  }

  private clearSettingsTimer() {
    if (this.settingsTimer) clearTimeout(this.settingsTimer);
    this.settingsTimer = null;
  }

  private commitSettings() {
    this.clearSettingsTimer();
    const current = this.getValue();
    const width = this.clampInput(this.widthInput, current.width, 1, MAX_WIDTH);
    const height = this.clampInput(this.heightInput, current.height, 1, MAX_HEIGHT);
    const format = normalizeImageFormat(this.formatSelect?.value, current.format);
    if (width === current.width && height === current.height && format === current.format) return;

    const nextValue: TftEsPiImageValue = {
      ...current,
      width,
      height,
      format,
      encoding: getImageEncoding(format),
      data: '',
    };
    this.setValue(nextValue, !this.isDropdownOpen());
    if (nextValue.sourcePath) {
      this.scheduleRedecodeFromSource();
    } else if (current.data) {
      this.setStatus(translateMessage('ERROR_SOURCE_MISSING_REDECODE'), true);
    }
  }

  private clampInput(
    input: HTMLInputElement | null,
    fallback: number,
    min: number,
    max: number,
  ) {
    const parsed = Number(input?.value);
    const normalized = Number.isFinite(parsed)
      ? Math.min(max, Math.max(min, Math.floor(parsed)))
      : fallback;
    if (input) input.value = String(normalized);
    return normalized;
  }

  private async onFileSelected() {
    const file = this.fileInput?.files?.[0];
    if (!file) return;
    this.commitSettings();
    this.clearSourceRedecodeTimer();
    const uploadRequestId = ++this.uploadRequestId;

    try {
      if (!this.isSupportedSource(file.name, file.type)) {
        throw new Error(translateMessage('ERROR_UNSUPPORTED_FILE_TYPE'));
      }
      if (file.size > MAX_SOURCE_FILE_SIZE_BYTES) {
        throw new Error(translateMessage('ERROR_FILE_SIZE_EXCEEDED', {
          maxSize: this.formatFileSize(MAX_SOURCE_FILE_SIZE_BYTES),
          currentSize: this.formatFileSize(file.size),
        }));
      }

      this.setStatus(translateMessage('STATUS_READING_FILE', { name: file.name }));
      const buffer = await file.arrayBuffer();
      if (!this.isUploadOperationCurrent(uploadRequestId)) return;
      this.setStatus(translateMessage('STATUS_SAVING_FILE', { name: file.name }));
      const sourcePath = this.persistSourceFile(file, buffer);
      const current = this.getValue();
      await this.decodeAndApplyImage({
        fileName: file.name,
        mimeType: file.type || this.inferMimeType(file.name),
        buffer,
        sourcePath,
      }, current.width, current.height, current.format, uploadRequestId);
    } catch (error: any) {
      if (!this.isUploadOperationCurrent(uploadRequestId)) return;
      this.setStatus(error?.message || translateMessage('ERROR_DECODE_FAILED'), true);
    } finally {
      if (this.fileInput && uploadRequestId === this.uploadRequestId) this.fileInput.value = '';
    }
  }

  private async decodeAndApplyImage(
    source: ImageDecodeSource,
    width: number,
    height: number,
    format: TftEsPiImageFormat,
    expectedRequestId: number,
    showDecodeStatus = true,
  ) {
    if (!this.isUploadOperationCurrent(expectedRequestId)) return;
    if (showDecodeStatus) this.setStatus(translateMessage('STATUS_DECODING'));
    const image = await this.decodeImage(new Blob([source.buffer], { type: source.mimeType }));
    try {
      if (!this.isUploadOperationCurrent(expectedRequestId)) return;
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext('2d', { willReadFrequently: true });
      if (!context) throw new Error(translateMessage('ERROR_DECODE_FAILED'));
      context.fillStyle = '#000';
      context.fillRect(0, 0, width, height);
      context.drawImage(image, 0, 0, width, height);

      const data = this.packCanvas(canvas, width, height, format);
      if (!data) throw new Error(translateMessage('ERROR_DECODE_FAILED'));
      if (!this.isUploadOperationCurrent(expectedRequestId)) return;
      const result: TftEsPiImageValue = {
        version: 1,
        format,
        encoding: getImageEncoding(format),
        width,
        height,
        data,
        sourceName: source.fileName,
        sourceType: source.mimeType,
        sourcePath: source.sourcePath,
      };
      this.applyingDecodedValue = true;
      try {
        this.setValue(result, !this.isDropdownOpen());
        this.updateStatusFromValue();
      } finally {
        this.applyingDecodedValue = false;
      }
    } finally {
      this.closeDecodedImage(image);
    }
  }

  private async decodeImage(file: Blob): Promise<ImageBitmap | HTMLImageElement> {
    if (typeof createImageBitmap === 'function') return createImageBitmap(file);

    const objectUrl = URL.createObjectURL(file);
    try {
      return await new Promise<HTMLImageElement>((resolve, reject) => {
        const image = new Image();
        image.onload = () => resolve(image);
        image.onerror = () => reject(new Error(translateMessage('ERROR_DECODE_FAILED')));
        image.src = objectUrl;
      });
    } finally {
      URL.revokeObjectURL(objectUrl);
    }
  }

  private closeDecodedImage(image: ImageBitmap | HTMLImageElement) {
    if ('close' in image && typeof image.close === 'function') image.close();
  }

  private scheduleRedecodeFromSource() {
    this.clearSourceRedecodeTimer();
    this.sourceRedecodeTimer = setTimeout(() => {
      this.sourceRedecodeTimer = null;
      void this.redecodeFromSource();
    }, 0);
  }

  private clearSourceRedecodeTimer() {
    if (this.sourceRedecodeTimer) clearTimeout(this.sourceRedecodeTimer);
    this.sourceRedecodeTimer = null;
  }

  private async redecodeFromSource() {
    const value = this.getValue();
    if (!value.sourcePath) return;
    const sourceFilePath = this.resolveSourceFilePath(value.sourcePath);
    const fsApi = (window as any)['fs'];
    if (!sourceFilePath || (!fsApi?.readFileBuffer && !fsApi?.readFileAsBase64)) {
      this.setStatus(translateMessage('ERROR_SOURCE_MISSING_REDECODE'), true);
      return;
    }
    if (typeof fsApi.existsSync === 'function' && !fsApi.existsSync(sourceFilePath)) {
      this.setStatus(translateMessage('ERROR_SOURCE_NOT_FOUND', { path: value.sourcePath }), true);
      return;
    }

    const requestId = ++this.uploadRequestId;
    try {
      const sourceName = value.sourceName || this.getPathBaseName(value.sourcePath);
      this.setStatus(translateMessage('STATUS_REDECODING', { name: sourceName }));
      await this.decodeAndApplyImage({
        fileName: sourceName,
        mimeType: value.sourceType || this.inferMimeType(value.sourcePath),
        buffer: this.readSourceFileBuffer(sourceFilePath, fsApi),
        sourcePath: value.sourcePath,
      }, value.width, value.height, value.format, requestId, false);
    } catch (error: any) {
      if (!this.isUploadOperationCurrent(requestId)) return;
      this.setStatus(error?.message || translateMessage('ERROR_REDECODE_FAILED'), true);
    }
  }

  private persistSourceFile(file: File, buffer: ArrayBuffer) {
    const projectPath = this.getCurrentProjectPath();
    const fsApi = (window as any)['fs'];
    const pathApi = (window as any)['path'];
    if (!projectPath || !fsApi || !pathApi?.join || !pathApi?.relative) {
      throw new Error(translateMessage('ERROR_PROJECT_PATH_MISSING'));
    }
    if (typeof fsApi.mkdirSync !== 'function') {
      throw new Error(translateMessage('ERROR_FS_CREATE_ASSETS_UNAVAILABLE'));
    }

    const assetsDir = pathApi.join(projectPath, 'assets', 'tftespi-image');
    fsApi.mkdirSync(assetsDir);
    const fileName = `${this.calculateSourceMd5(buffer, fsApi)}${this.getSourceExtension(file.name, file.type)}`;
    const assetFilePath = pathApi.join(assetsDir, fileName);
    if (typeof fsApi.existsSync === 'function' && fsApi.existsSync(assetFilePath)) {
      return this.normalizeAssetPath(pathApi.relative(projectPath, assetFilePath));
    }
    if (typeof fsApi.writeFileBuffer === 'function') {
      fsApi.writeFileBuffer(assetFilePath, buffer);
    } else if (typeof fsApi.writeFileSync === 'function') {
      fsApi.writeFileSync(assetFilePath, new Uint8Array(buffer));
    } else if (typeof fsApi.writeBase64File === 'function') {
      fsApi.writeBase64File(assetFilePath, bytesToBase64(new Uint8Array(buffer)));
    } else {
      throw new Error(translateMessage('ERROR_FS_SAVE_UNAVAILABLE'));
    }
    return this.normalizeAssetPath(pathApi.relative(projectPath, assetFilePath));
  }

  private calculateSourceMd5(buffer: ArrayBuffer, fsApi: any) {
    if (typeof fsApi.md5Buffer !== 'function') {
      throw new Error(translateMessage('ERROR_MD5_UNAVAILABLE'));
    }
    const md5 = String(fsApi.md5Buffer(buffer) || '').toLowerCase();
    if (!/^[a-f0-9]{32}$/.test(md5)) {
      throw new Error(translateMessage('ERROR_MD5_FAILED'));
    }
    return md5;
  }

  private readSourceFileBuffer(sourceFilePath: string, fsApi: any): ArrayBuffer {
    if (typeof fsApi.readFileBuffer === 'function') {
      return this.toArrayBuffer(fsApi.readFileBuffer(sourceFilePath));
    }
    if (typeof fsApi.readFileAsBase64 === 'function') {
      return base64ToBytes(fsApi.readFileAsBase64(sourceFilePath)).buffer;
    }
    throw new Error(translateMessage('ERROR_FS_READ_UNAVAILABLE'));
  }

  private toArrayBuffer(data: unknown): ArrayBuffer {
    if (data instanceof ArrayBuffer) return data;
    if (ArrayBuffer.isView(data)) {
      const view = data as ArrayBufferView;
      return view.buffer.slice(view.byteOffset, view.byteOffset + view.byteLength);
    }
    if (Array.isArray(data)) return new Uint8Array(data).buffer;
    const maybeBuffer = data as { type?: string; data?: unknown };
    if (maybeBuffer?.type === 'Buffer' && Array.isArray(maybeBuffer.data)) {
      return new Uint8Array(maybeBuffer.data).buffer;
    }
    throw new Error(translateMessage('ERROR_SOURCE_READ_INVALID'));
  }

  private resolveSourceFilePath(sourcePath: string): string | null {
    const projectPath = this.getCurrentProjectPath();
    const pathApi = (window as any)['path'];
    if (!projectPath || !sourcePath || !pathApi?.join || !pathApi?.resolve || !pathApi?.relative) return null;
    const trimmed = sourcePath.trim();
    const fullPath = typeof pathApi.isAbsolute === 'function' && pathApi.isAbsolute(trimmed)
      ? trimmed
      : pathApi.join(projectPath, ...trimmed.split(/[\\/]+/).filter(Boolean));
    const projectRoot = pathApi.resolve(projectPath);
    const resolved = pathApi.resolve(fullPath);
    const relative = pathApi.relative(projectRoot, resolved);
    if (relative.startsWith('..') || (typeof pathApi.isAbsolute === 'function' && pathApi.isAbsolute(relative))) {
      return null;
    }
    return resolved;
  }

  private getCurrentProjectPath(): string | null {
    const projectServicePath = (window as any)['projectService']?.currentProjectPath;
    if (typeof projectServicePath === 'string' && projectServicePath.trim()) return projectServicePath;
    const searchPath = new URLSearchParams(window.location.search).get('path');
    if (searchPath) return searchPath;
    const hashQueryIndex = window.location.hash.indexOf('?');
    if (hashQueryIndex >= 0) {
      return new URLSearchParams(window.location.hash.slice(hashQueryIndex + 1)).get('path');
    }
    return null;
  }

  private packCanvas(
    sourceCanvas: HTMLCanvasElement,
    width: number,
    height: number,
    format: TftEsPiImageFormat,
  ) {
    if (getImageByteLength(width, height, format) > MAX_OUTPUT_BYTES) return '';
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) return '';
    context.fillStyle = '#000';
    context.fillRect(0, 0, width, height);
    context.drawImage(sourceCanvas, 0, 0, width, height);
    const rgba = context.getImageData(0, 0, width, height).data;
    const bytes = new Uint8Array(getImageByteLength(width, height, format));

    for (let source = 0, pixel = 0; source < rgba.length; source += 4, pixel++) {
      const alpha = rgba[source + 3];
      const red = alpha === 255 ? rgba[source] : Math.round(rgba[source] * alpha / 255);
      const green = alpha === 255 ? rgba[source + 1] : Math.round(rgba[source + 1] * alpha / 255);
      const blue = alpha === 255 ? rgba[source + 2] : Math.round(rgba[source + 2] * alpha / 255);
      if (format === 'rgb332') {
        bytes[pixel] = (red & 0xe0) | ((green & 0xe0) >> 3) | (blue >> 6);
      } else {
        const colour = ((red & 0xf8) << 8) | ((green & 0xfc) << 3) | (blue >> 3);
        bytes[pixel * 2] = colour >> 8;
        bytes[pixel * 2 + 1] = colour & 0xff;
      }
    }
    return bytesToBase64(bytes);
  }

  private drawValueToCanvas(canvas: HTMLCanvasElement, value: TftEsPiImageValue) {
    canvas.width = value.width;
    canvas.height = value.height;
    const context = canvas.getContext('2d');
    if (!context) return;
    context.fillStyle = '#000';
    context.fillRect(0, 0, value.width, value.height);
    if (!value.data) return;

    let bytes: Uint8Array;
    try {
      bytes = base64ToBytes(value.data);
    } catch {
      return;
    }
    if (bytes.length !== getImageByteLength(value.width, value.height, value.format)) return;

    const imageData = context.createImageData(value.width, value.height);
    for (let pixel = 0; pixel < value.width * value.height; pixel++) {
      const target = pixel * 4;
      if (value.format === 'rgb332') {
        const colour = bytes[pixel];
        imageData.data[target] = Math.round(((colour >> 5) & 0x07) * 255 / 7);
        imageData.data[target + 1] = Math.round(((colour >> 2) & 0x07) * 255 / 7);
        imageData.data[target + 2] = Math.round((colour & 0x03) * 255 / 3);
      } else {
        const colour = (bytes[pixel * 2] << 8) | bytes[pixel * 2 + 1];
        imageData.data[target] = Math.round(((colour >> 11) & 0x1f) * 255 / 31);
        imageData.data[target + 1] = Math.round(((colour >> 5) & 0x3f) * 255 / 63);
        imageData.data[target + 2] = Math.round((colour & 0x1f) * 255 / 31);
      }
      imageData.data[target + 3] = 255;
    }
    context.putImageData(imageData, 0, 0);
  }

  private renderPreview() {
    if (this.previewCanvas) this.drawValueToCanvas(this.previewCanvas, this.getValue());
  }

  private updateBlockDisplayImage() {
    if (!this.blockDisplayImage) return;
    if (!this.blockPreviewDataUrl) {
      const canvas = document.createElement('canvas');
      this.drawValueToCanvas(canvas, this.getValue());
      this.blockPreviewDataUrl = canvas.toDataURL('image/png');
    }
    this.blockDisplayImage.setAttributeNS(
      'http://www.w3.org/1999/xlink',
      'href',
      this.blockPreviewDataUrl,
    );
  }

  private updateControlsFromValue() {
    const value = this.getValue();
    if (this.widthInput) this.widthInput.value = String(value.width);
    if (this.heightInput) this.heightInput.value = String(value.height);
    if (this.formatSelect) this.formatSelect.value = value.format;
  }

  private updateStatusFromValue() {
    if (!this.statusElement) return;
    const value = this.getValue();
    if (!value.data) {
      this.setStatus(Blockly.Msg['TFTESPI_IMAGE_EMPTY']);
      return;
    }
    this.setStatus(translateMessage('STATUS_INFO', {
      sourcePrefix: value.sourceName ? `${this.truncateSourceName(value.sourceName)} | ` : '',
      width: value.width,
      height: value.height,
      mode: value.format.toUpperCase(),
      dataSize: this.formatDataSize(getImageByteLength(value.width, value.height, value.format)),
    }));
  }

  private truncateSourceName(sourceName: string) {
    return Array.from(sourceName).length > 18
      ? `${Array.from(sourceName).slice(0, 15).join('')}...`
      : sourceName;
  }

  private setStatus(message: string, isError = false) {
    if (!this.statusElement) return;
    this.statusElement.textContent = message;
    this.statusElement.title = message;
    this.statusElement.classList.toggle('is-error', isError);
  }

  private clearImage() {
    this.clearSettingsTimer();
    this.clearSourceRedecodeTimer();
    this.uploadRequestId += 1;
    this.setValue(this.createEmptyValue({
      width: this.imgWidth,
      height: this.imgHeight,
      format: this.pixelFormat,
    }), !this.isDropdownOpen());
  }

  private createEmptyValue(config?: FieldTftEsPiImageFromJsonConfig): TftEsPiImageValue {
    const width = this.normalizeNumber(config?.width, DEFAULT_WIDTH, 1, MAX_WIDTH);
    const height = this.normalizeNumber(config?.height, DEFAULT_HEIGHT, 1, MAX_HEIGHT);
    const format = normalizeImageFormat(config?.format);
    return {
      version: 1,
      format,
      encoding: getImageEncoding(format),
      width,
      height,
      data: '',
    };
  }

  private normalizeValue(
    value?: TftEsPiImageValue | null,
    config?: FieldTftEsPiImageFromJsonConfig,
  ): TftEsPiImageValue {
    const fallback = this.createEmptyValue(config);
    if (!value || typeof value !== 'object' || value.version !== 1) return fallback;
    const format = normalizeImageFormat(value.format, fallback.format);
    if (value.encoding !== getImageEncoding(format)) return fallback;
    const width = this.normalizeNumber(value.width, fallback.width, 1, MAX_WIDTH);
    const height = this.normalizeNumber(value.height, fallback.height, 1, MAX_HEIGHT);
    const expectedLength = Math.ceil(getImageByteLength(width, height, format) / 3) * 4;
    const data = typeof value.data === 'string'
      && value.data.length === expectedLength
      && /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value.data)
      ? value.data
      : '';
    return {
      version: 1,
      format,
      encoding: getImageEncoding(format),
      width,
      height,
      data,
      sourceName: typeof value.sourceName === 'string' ? value.sourceName : undefined,
      sourceType: typeof value.sourceType === 'string' ? value.sourceType : undefined,
      sourcePath: typeof value.sourcePath === 'string' ? value.sourcePath : undefined,
    };
  }

  private normalizeNumber(value: unknown, fallback: number, min: number, max: number) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? Math.min(max, Math.max(min, Math.floor(parsed))) : fallback;
  }

  private cloneValue(value: TftEsPiImageValue | null) {
    return { ...this.normalizeValue(value) };
  }

  private syncSettings(value: TftEsPiImageValue) {
    this.imgWidth = value.width;
    this.imgHeight = value.height;
    this.pixelFormat = value.format;
  }

  private valuesEqual(left: TftEsPiImageValue | null, right: TftEsPiImageValue | null) {
    return JSON.stringify(left) === JSON.stringify(right);
  }

  private rerenderSourceBlockAfterResize() {
    const sourceBlock = this.getSourceBlock();
    if (!(sourceBlock instanceof Blockly.BlockSvg) || this.sourceBlockRenderScheduled) return;

    const rootBlock = typeof sourceBlock.getRootBlock === 'function'
      ? sourceBlock.getRootBlock()
      : sourceBlock;
    const blockToRender = rootBlock instanceof Blockly.BlockSvg ? rootBlock : sourceBlock;
    if (!blockToRender.rendered) return;

    this.sourceBlockRenderScheduled = true;
    const renderBlock = () => {
      this.sourceBlockRenderScheduled = false;
      if (!blockToRender.rendered) return;
      blockToRender.render();
      if (this.isDropdownOpen()) Blockly.DropDownDiv.repositionForWindowResize();
    };
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(renderBlock);
    else Promise.resolve().then(renderBlock);
  }

  private disposeDropdown() {
    this.clearSettingsTimer();
    this.commitSettings();
    if (
      this.getSourceBlock()
      && this.initialValue
      && !this.valuesEqual(this.initialValue, this.getValue())
    ) {
      Blockly.Events.fire(new (Blockly.Events.get(Blockly.Events.BLOCK_CHANGE))(
        this.sourceBlock_,
        'field',
        this.name || null,
        this.initialValue,
        this.getValue(),
      ));
    }
    this.initialValue = null;
    this.previewCanvas = null;
    this.statusElement = null;
    this.fileInput = null;
    this.widthInput = null;
    this.heightInput = null;
    this.formatSelect = null;
    Blockly.DropDownDiv.getContentDiv().classList.remove(
      'contains-tftespi-image-editor',
      'ailyMediaFieldDropdown',
    );
  }

  private isDropdownOpen() {
    return Blockly.DropDownDiv.getOwner() === this;
  }

  private isUploadOperationCurrent(uploadRequestId: number) {
    return !this.isDisposed && uploadRequestId === this.uploadRequestId;
  }

  private isSupportedSource(fileName: string, mimeType: string) {
    const lowerName = fileName.toLowerCase();
    const lowerType = (mimeType || '').toLowerCase();
    return /\.(png|jpe?g|webp|bmp)$/.test(lowerName)
      || /^image\/(png|jpeg|webp|bmp|x-ms-bmp)$/.test(lowerType);
  }

  private inferMimeType(fileName: string) {
    const extension = this.getPathExtension(fileName).toLowerCase();
    if (extension === '.jpg' || extension === '.jpeg') return 'image/jpeg';
    if (extension === '.webp') return 'image/webp';
    if (extension === '.bmp') return 'image/bmp';
    return 'image/png';
  }

  private getSourceExtension(fileName: string, mimeType: string) {
    const extension = this.getPathExtension(fileName).toLowerCase();
    if (['.png', '.jpg', '.jpeg', '.webp', '.bmp'].includes(extension)) return extension;
    const lowerType = mimeType.toLowerCase();
    if (lowerType.includes('jpeg')) return '.jpg';
    if (lowerType.includes('webp')) return '.webp';
    if (lowerType.includes('bmp')) return '.bmp';
    return '.png';
  }

  private getPathExtension(fileName: string) {
    const pathApi = (window as any)['path'];
    if (pathApi?.extname) return pathApi.extname(fileName) || '';
    return /\.[^./\\]+$/.exec(fileName)?.[0] || '';
  }

  private getPathBaseName(fileName: string) {
    const pathApi = (window as any)['path'];
    if (pathApi?.basename) return pathApi.basename(fileName);
    return fileName.split(/[\\/]/).pop() || fileName;
  }

  private normalizeAssetPath(assetPath: string) {
    return assetPath.replace(/\\/g, '/').replace(/^\.\//, '');
  }

  private formatFileSize(bytes: number) {
    return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
  }

  private formatDataSize(bytes: number) {
    if (bytes < 1024) return `${bytes} B`;
    return `${(bytes / 1024).toFixed(1)} KB`;
  }

  private createElement(elementType: string, className: string) {
    const element = document.createElement(elementType);
    element.className = className;
    return element;
  }
}

Blockly.fieldRegistry.register('field_tftespi_image', FieldTftEsPiImage);

Blockly.Css.register(`
.tftEsPiImageEditor {
  align-items: stretch;
  background: #2a2a2a;
  box-sizing: border-box;
  color: #f4f4f4;
  display: flex;
  flex-direction: column;
  gap: 8px;
  max-width: min(94vw, 720px);
  padding: 8px 10px;
  width: max-content;
}
.tftEsPiImageToolbar,
.tftEsPiImageSettings,
.tftEsPiImageActions {
  align-items: center;
  display: flex;
  gap: 8px;
}
.tftEsPiImageToolbar {
  flex-wrap: wrap;
  justify-content: space-between;
}
.tftEsPiImageNumberControl {
  align-items: center;
  display: flex;
  gap: 4px;
  white-space: nowrap;
}
.tftEsPiImageNumberControl input,
.tftEsPiImageNumberControl select,
.tftEsPiImageButton {
  background: #3b3b3b;
  border: 1px solid #666;
  border-radius: 4px;
  box-sizing: border-box;
  color: #f4f4f4;
  height: 28px;
}
.tftEsPiImageNumberControl input { width: 58px; }
.tftEsPiImageNumberControl select { width: 82px; }
.tftEsPiImageButton {
  cursor: pointer;
  padding: 0 10px;
}
.tftEsPiImageButton:hover { background: #4a4a4a; }
.tftEsPiImageStatus {
  color: #ccc;
  min-height: 18px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.tftEsPiImageStatus.is-error { color: #ff8a80; }
.tftEsPiImagePreview {
  align-items: center;
  background:
    linear-gradient(45deg, #333 25%, transparent 25%),
    linear-gradient(-45deg, #333 25%, transparent 25%),
    linear-gradient(45deg, transparent 75%, #333 75%),
    linear-gradient(-45deg, transparent 75%, #333 75%),
    #292929;
  background-position: 0 0, 0 6px, 6px -6px, -6px 0;
  background-size: 12px 12px;
  display: flex;
  justify-content: center;
  min-height: 140px;
  overflow: auto;
  padding: 8px;
}
.tftEsPiImageCanvas {
  image-rendering: pixelated;
  max-height: min(58vh, 360px);
  max-width: min(86vw, 640px);
  object-fit: contain;
}
.blocklyDropDownContent.contains-tftespi-image-editor { max-height: none; }
`);
