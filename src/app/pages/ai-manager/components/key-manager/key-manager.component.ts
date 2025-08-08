import { Component, Input, Output, EventEmitter } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

export interface KeyManagerCategory {
  id: string;
  name: string;
  icon: string;
  color: string;
  expanded: boolean;
  items: KeyManagerItem[];
}

export interface KeyManagerItem {
  id: string;
  key: string;
  value: string;
  type: 'string' | 'number' | 'boolean' | 'json' | 'url' | 'file';
  description?: string;
  tags: string[];
  category: string;
  isSecret: boolean;
  lastModified: Date;
  accessCount: number;
}

export interface KeyMemoryStats {
  total: number;
  categories: number;
  recentlyUsed: number;
  secrets: number;
}

@Component({
  selector: 'app-key-memory',
  imports: [CommonModule, FormsModule],
  templateUrl: './key-manager.component.html',
  styleUrl: './key-manager.component.scss'
})
export class KeyManagerComponent {
  @Input() keyMemoryStats: KeyMemoryStats = {
    total: 0,
    categories: 0,
    recentlyUsed: 0,
    secrets: 0
  };

  @Input() keyMemoryCategories = [];
  @Input() recentItems = [];
  @Input() quickAccessItems = [];

  @Output() addKeyMemory = new EventEmitter<void>();
  @Output() importKeyMemory = new EventEmitter<void>();
  @Output() exportKeyMemory = new EventEmitter<void>();
  @Output() editKeyMemory = new EventEmitter();
  @Output() deleteKeyMemory = new EventEmitter();
  @Output() copyKeyMemory = new EventEmitter();
  @Output() searchKeyMemory = new EventEmitter<string>();
  @Output() toggleSecret = new EventEmitter();

  searchQuery = '';
  selectedType = 'all';
  showSecrets = false;

  onAddKeyMemory() {
    this.addKeyMemory.emit();
  }

  onImportKeyMemory() {
    this.importKeyMemory.emit();
  }

  onExportKeyMemory() {
    this.exportKeyMemory.emit();
  }

  onEditKeyMemory(item) {
    this.editKeyMemory.emit(item);
  }

  onDeleteKeyMemory(item) {
    this.deleteKeyMemory.emit(item);
  }

  onCopyKeyMemory(item) {
    this.copyKeyMemory.emit(item);
  }

  onSearchKeyMemory() {
    this.searchKeyMemory.emit(this.searchQuery);
  }

  onToggleSecret(item) {
    this.toggleSecret.emit(item);
  }

  toggleCategory(category) {
    category.expanded = !category.expanded;
  }

  getTypeIcon(type: string): string {
    const iconMap: { [key: string]: string } = {
      'string': 'icon-text',
      'number': 'icon-number',
      'boolean': 'icon-toggle',
      'json': 'icon-code',
      'url': 'icon-link',
      'file': 'icon-file'
    };
    return iconMap[type] || 'icon-text';
  }

  getTypeColor(type: string): string {
    const colorMap: { [key: string]: string } = {
      'string': '#4299e1',
      'number': '#48bb78',
      'boolean': '#ed8936',
      'json': '#9f7aea',
      'url': '#38b2ac',
      'file': '#f56565'
    };
    return colorMap[type] || '#4299e1';
  }

  formatValue(item): string {
    if (item.isSecret && !this.showSecrets) {
      return '••••••••';
    }

    if (item.type === 'boolean') {
      return item.value === 'true' ? '✓' : '✗';
    }

    if (item.type === 'json') {
      try {
        const obj = JSON.parse(item.value);
        return JSON.stringify(obj, null, 2);
      } catch {
        return item.value;
      }
    }

    return item.value;
  }

  isValueTruncated(value: string): boolean {
    return value.length > 50;
  }

  truncateValue(value: string): string {
    return value.length > 50 ? value.substring(0, 50) + '...' : value;
  }
}
