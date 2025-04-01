import { Injectable } from '@angular/core';
import { TranslateService } from '@ngx-translate/core';
import { locale as enLang } from '../configs/i18n/en';
import { locale as chLang } from '../configs/i18n/ch';


export interface Locale {
  lang: string;
  data: Object;
}

@Injectable({
  providedIn: 'root'
})
export class TranslationService {
  language;
  constructor(private translate: TranslateService) {
  }

  init() {
    this.translate.setDefaultLang(this.getSystemLanguage());
    this.translate.setTranslation(enLang.lang, enLang.data, true);
    this.translate.setTranslation(chLang.lang, chLang.data, true);
    this.setLanguage(this.getSelectedLanguage());
  }

  getSystemLanguage(): string {
    const language = navigator.language || (navigator.languages && navigator.languages[0]);
    return language.toLocaleLowerCase()
  }

  setLanguage(lang) {
    if (lang) {
      this.translate.use(this.translate.getDefaultLang());
      this.translate.use(lang);
      localStorage.setItem('language', lang);
    }
  }

  getLanguageList() {
    return this.translate.getLangs()
  }

  getSelectedLanguage() {
    return localStorage.getItem('language') || this.translate.getDefaultLang();
  }
}
