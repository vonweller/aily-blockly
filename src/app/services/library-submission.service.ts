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
}

@Injectable({
  providedIn: 'root',
})
export class LibrarySubmissionService {
  constructor(
    private http: HttpClient,
    private blocklyLibraryPackageService: BlocklyLibraryPackageService,
  ) { }

  submitLocalLibrary(projectPath: string, packageName: string): Observable<LibrarySubmissionResponse> {
    const bundle = this.blocklyLibraryPackageService.readLibrarySubmissionPackage(projectPath, packageName);
    return this.submitBundle(bundle);
  }

  submitLocalLibraryByRef(ref: BlocklyLibraryPackageRef): Observable<LibrarySubmissionResponse> {
    const bundle = this.blocklyLibraryPackageService.readLibrarySubmissionPackageByRef(ref);
    return this.submitBundle(bundle);
  }

  submitBundle(bundle: BlocklyLibrarySubmissionBundle): Observable<LibrarySubmissionResponse> {
    const payload: LibrarySubmissionPayload = { package: bundle.package };
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
    const source = error instanceof HttpErrorResponse ? (error.error ?? error) : error;
    const details = extractApiErrorDetails(source, '库提交失败');
    const normalized: LibrarySubmissionApiError = {
      ...details,
      status: error instanceof HttpErrorResponse ? error.status : undefined,
      raw: error,
    };
    return throwError(() => normalized);
  }
}
