import { Component, Input, Output, EventEmitter } from '@angular/core';
import { CommonModule } from '@angular/common';

export interface HardwareCategory {
  id: string;
  name: string;
  icon: string;
  count: number;
}

export interface Hardware {
  id: string;
  name: string;
  model: string;
  image: string;
  status: 'connected' | 'disconnected' | 'error';
  keySpecs: string[];
  pins?: Pin[];
}

export interface Pin {
  number: string;
  function?: string;
  type: string;
  configured: boolean;
}

@Component({
  selector: 'app-hardware-manager',
  imports: [CommonModule],
  templateUrl: './hardware-manager.component.html',
  styleUrl: './hardware-manager.component.scss'
})
export class HardwareManagerComponent {
  @Input() hardwareCategories: HardwareCategory[] = [];
  @Input() filteredHardware: Hardware[] = [];
  @Input() selectedHardware: Hardware | null = null;
  @Input() selectedHardwareCategory: string = '';

  @Output() addHardware = new EventEmitter<void>();
  @Output() scanHardware = new EventEmitter<void>();
  @Output() selectHardwareCategory = new EventEmitter<string>();
  @Output() configureHardware = new EventEmitter<Hardware>();
  @Output() viewHardwareDetails = new EventEmitter<Hardware>();
  @Output() configurePin = new EventEmitter<Pin>();

  onAddHardware() {
    this.addHardware.emit();
  }

  onScanHardware() {
    this.scanHardware.emit();
  }

  onSelectHardwareCategory(categoryId: string) {
    this.selectHardwareCategory.emit(categoryId);
  }

  onConfigureHardware(hardware: Hardware) {
    this.configureHardware.emit(hardware);
  }

  onViewHardwareDetails(hardware: Hardware) {
    this.viewHardwareDetails.emit(hardware);
  }

  onConfigurePin(pin: Pin) {
    this.configurePin.emit(pin);
  }
}
