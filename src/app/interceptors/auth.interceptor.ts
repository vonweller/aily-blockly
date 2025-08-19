import { inject } from '@angular/core';
import { HttpInterceptorFn, HttpRequest, HttpHandlerFn, HttpEvent, HttpErrorResponse } from '@angular/common/http';
import { Observable, throwError, BehaviorSubject, filter, take, switchMap, catchError, from } from 'rxjs';
import { AuthService } from '../services/auth.service';
import { API } from '../configs/api.config';

let isRefreshing = false;
let refreshTokenSubject: BehaviorSubject<any> = new BehaviorSubject<any>(null);

function shouldInterceptRequest(url: string): boolean {
  // 获取API配置中的所有URL
  const apiUrls = Object.values(API);
  
  // 检查请求URL是否匹配任何配置的API地址
  return apiUrls.some(apiUrl => url.startsWith(apiUrl));
}

export const authInterceptor: HttpInterceptorFn = (req: HttpRequest<any>, next: HttpHandlerFn): Observable<HttpEvent<any>> => {
  const authService = inject(AuthService);

  // 检查是否需要拦截此请求
  if (!shouldInterceptRequest(req.url)) {
    return next(req);
  }

  return from(addTokenHeader(req, authService)).pipe(
    switchMap(request => next(request)),
    catchError(error => {
      if (error instanceof HttpErrorResponse && !req.url.includes('auth/login') && error.status === 401) {
        return handle401Error(req, next, authService);
      }
      return throwError(() => error);
    })
  );
};

async function addTokenHeader(request: HttpRequest<any>, authService: AuthService, token?: string | null): Promise<HttpRequest<any>> {
  if (!token) {
    token = await authService.getToken2();
  }

  if (token) {
    return request.clone({
      setHeaders: {
        Authorization: `Bearer ${token}`
      }
    });
  }

  return request;
}

function handle401Error(request: HttpRequest<any>, next: HttpHandlerFn, authService: AuthService): Observable<HttpEvent<any>> {
  if (!isRefreshing) {
    isRefreshing = true;
    refreshTokenSubject.next(null);

    return from(authService.refreshAuthToken()).pipe(
      switchMap((success: boolean) => {
        isRefreshing = false;
        if (success) {
          return from(authService.getToken()).pipe(
            switchMap(token => {
              refreshTokenSubject.next(token);
              return from(addTokenHeader(request, authService, token)).pipe(
                switchMap(req => next(req))
              );
            })
          );
        } else {
          authService.logout();
          return throwError(() => new Error('Token refresh failed'));
        }
      }),
      catchError((err) => {
        isRefreshing = false;
        authService.logout();
        return throwError(() => err);
      })
    );
  }

  return refreshTokenSubject.pipe(
    filter(token => token !== null),
    take(1),
    switchMap(token => 
      from(addTokenHeader(request, authService, token)).pipe(
        switchMap(req => next(req))
      )
    )
  );
}
