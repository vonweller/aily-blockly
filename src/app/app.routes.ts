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
    // {
    //     path:"sub",
    //     loadComponent: () => import('./sub-window/sub-window.component').then(m => m.SubWindowComponent)
    // },
    {
        path: "project-new",
        loadComponent: () => import('./windows/project-new/project-new.component').then(m => m.ProjectNewComponent)
    },
    {
        path: "settings",
        loadComponent: () => import('./windows/settings/settings.component').then(m => m.SettingsComponent)
    },
    {
        path: "about",
        loadComponent: () => import('./windows/about/about.component').then(m => m.AboutComponent)
    }
];
