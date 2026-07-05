import { Injectable } from '@angular/core';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Observable, throwError } from 'rxjs';
import { catchError } from 'rxjs/operators';
import { API } from '../configs/api.config';
import {
  BlocklyLibraryPackageRef,
  BlocklyLibraryPackageService,
  BlocklyLibrarySubmissionBundle,
  BlocklyLibrarySubmissionPackage,
} from './blockly-library-package.service';
import { extractApiErrorDetails, ApiErrorDetails } from '../utils/api-error.utils';

export interface LibrarySubmissionPayload {
  package: BlocklyLibrarySubmissionPackage;
  confirmExisting?: boolean;
}

export interface LibrarySubmissionResult {
  id: number;
  mode: 'create' | 'update' | string;
  package_name: string;
  package_slug: string;
  target_dir: string;
  branch: string;
  pr_url: string | null;
  pr_number: number | null;
  status: string;
}

export interface LibrarySubmissionResponse {
  status: number;
  data?: LibrarySubmissionResult;
  messages?: string | string[] | null;
  errorCode?: string | null;
  errorArgs?: Record<string, unknown>;
  errorMessage?: string | null;
}

export interface LibrarySubmissionApiError extends ApiErrorDetails {
  status?: number;
  raw: unknown;
  submission?: LibrarySubmissionResult;
  sameContent?: boolean;
}

@Injectable({
  providedIn: 'root',
})
export class LibrarySubmissionService {
  constructor(
    private http: HttpClient,
    private blocklyLibraryPackageService: BlocklyLibraryPackageService,
  ) { }

  submitLocalLibrary(projectPath: string, packageName: string, confirmExisting = false): Observable<LibrarySubmissionResponse> {
    const bundle = this.blocklyLibraryPackageService.readLibrarySubmissionPackage(projectPath, packageName);
    return this.submitBundle(bundle, confirmExisting);
  }

  submitLocalLibraryByRef(ref: BlocklyLibraryPackageRef, confirmExisting = false): Observable<LibrarySubmissionResponse> {
    const bundle = this.blocklyLibraryPackageService.readLibrarySubmissionPackageByRef(ref);
    return this.submitBundle(bundle, confirmExisting);
  }

  submitBundle(bundle: BlocklyLibrarySubmissionBundle, confirmExisting = false): Observable<LibrarySubmissionResponse> {
    const payload: LibrarySubmissionPayload = { package: bundle.package };
    if (confirmExisting) {
      payload.confirmExisting = true;
    }
    if (bundle.srcArchivePath) {
      return this.submitMultipart(payload, bundle.srcArchivePath);
    }
    return this.submitJson(payload);
  }

  submitJson(payload: LibrarySubmissionPayload): Observable<LibrarySubmissionResponse> {
    return this.http.post<LibrarySubmissionResponse>(API.librarySubmissions, payload).pipe(
      catchError(error => this.handleError(error)),
    );
  }

  submitMultipart(payload: LibrarySubmissionPayload, srcArchivePath: string): Observable<LibrarySubmissionResponse> {
    const fileBuffer = window['fs'].readFileSync(srcArchivePath, null);
    const file = new File([fileBuffer], 'src.7z', { type: 'application/x-7z-compressed' });
    const formData = new FormData();
    formData.append('payload', JSON.stringify(payload));
    formData.append('src_archive', file, 'src.7z');

    return this.http.post<LibrarySubmissionResponse>(API.librarySubmissions, formData).pipe(
      catchError(error => this.handleError(error)),
    );
  }

  private handleError(error: HttpErrorResponse | unknown): Observable<never> {
    const source = this.getApiErrorPayload(error);
    const details = extractApiErrorDetails(source, '库提交失败');
    const normalized: LibrarySubmissionApiError = {
      ...details,
      status: error instanceof HttpErrorResponse ? error.status : undefined,
      raw: error,
      submission: this.getSubmissionFromErrorPayload(source),
      sameContent: this.getSameContentFromErrorPayload(source),
    };
    return throwError(() => normalized);
  }

  private getApiErrorPayload(error: HttpErrorResponse | unknown): unknown {
    if (!(error instanceof HttpErrorResponse)) {
      return error;
    }
    const body = error.error;
    if (body && typeof body === 'object' && !Array.isArray(body) && body['detail']) {
      return body['detail'];
    }
    return body ?? error;
  }

  private getSubmissionFromErrorPayload(source: unknown): LibrarySubmissionResult | undefined {
    if (!source || typeof source !== 'object' || Array.isArray(source)) {
      return undefined;
    }
    const submission = source['submission'];
    return submission && typeof submission === 'object' && !Array.isArray(submission)
      ? submission as LibrarySubmissionResult
      : undefined;
  }

  private getSameContentFromErrorPayload(source: unknown): boolean | undefined {
    if (!source || typeof source !== 'object' || Array.isArray(source)) {
      return undefined;
    }
    const value = source['same_content'] ?? source['sameContent'];
    return typeof value === 'boolean' ? value : undefined;
  }
}
