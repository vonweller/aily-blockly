import { CommonModule } from '@angular/common';
import { Component } from '@angular/core';
import { HEADER_MENU } from '../../configs/header.config';

@Component({
  selector: 'app-header',
  imports: [CommonModule],
  templateUrl: './header.component.html',
  styleUrl: './header.component.scss'
})
export class HeaderComponent {

  headerMenu = HEADER_MENU;
}
