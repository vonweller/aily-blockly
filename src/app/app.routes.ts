import { Routes } from '@angular/router';

export const routes: Routes = [
    {
        path: '',
        redirectTo: 'main',
        pathMatch: 'full'
    },
    {
        path: 'main',
        loadComponent: () => import('./main-window/main-window.component').then(m => m.MainWindowComponent)
    },
    {
        path:"sub",
        loadComponent: () => import('./sub-window/sub-window.component').then(m => m.SubWindowComponent)
    }
];
