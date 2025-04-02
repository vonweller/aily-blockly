import { Injectable } from '@angular/core';
import { TranslateService } from '@ngx-translate/core';
import { locale as enLang } from '../configs/i18n/en';
import { locale as zhcnLang } from '../configs/i18n/zh-cn';
import { locale as zhhkLang } from '../configs/i18n/zh-hk';

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
    this.translate.setTranslation(enLang.lang, enLang.data);
    this.translate.setTranslation(zhcnLang.lang, zhcnLang.data);
    this.translate.setTranslation(zhhkLang.lang, zhhkLang.data);
    let defaultLang = this.getSystemLanguage();
    this.translate.setDefaultLang(defaultLang);
    this.setLanguage(this.getSelectedLanguage());
  }

  getSystemLanguage(): string {
    const language = navigator.language || (navigator.languages && navigator.languages[0]);
    return language.toLocaleLowerCase()
  }

  setLanguage(lang: string) {
    this.translate.use(lang);
    localStorage.setItem('language', lang);
  }

  getLanguageList() {
    return this.translate.getLangs()
  }

  getSelectedLanguage() {
    return localStorage.getItem('language') || this.translate.getDefaultLang();
  }
}
