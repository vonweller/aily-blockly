import { Component, OnInit, OnDestroy, Input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Subscription } from 'rxjs';
import { BitmapUploadService, BitmapUploadRequest, BitmapUploadResponse } from '../../bitmap-upload.service';
import { NzButtonModule } from 'ng-zorro-antd/button';
import { FormsModule } from '@angular/forms';
import { NzModalRef } from 'ng-zorro-antd/modal';
import { ImageCropperComponent } from '../../../components/image-cropper/image-cropper.component';

@Component({
  selector: 'app-image-upload-dialog',
  standalone: true,
  imports: [CommonModule, FormsModule, NzButtonModule, ImageCropperComponent],
  templateUrl: './image-upload-dialog.component.html',
  styleUrls: ['./image-upload-dialog.component.scss']
})
export class ImageUploadDialogComponent implements OnInit, OnDestroy {
  @Input() title = '上传图片';
  value = '';
  croppedImageData: string | null = null;

  constructor(
    private bitmapUploadService: BitmapUploadService,
    private modal: NzModalRef
  ) { }

  onClose() {
    this.modal.triggerCancel()
  }
  onConfirm() {
    if (this.croppedImageData) {
      this.modal.close(this.croppedImageData);
    }
  }

  onImageCropped(imageData: string) {
    this.croppedImageData = imageData;
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
