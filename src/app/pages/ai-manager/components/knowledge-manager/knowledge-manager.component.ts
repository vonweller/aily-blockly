import { Component, Input, Output, EventEmitter } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

export interface KnowledgeCategory {
  id: string;
  name: string;
  expanded: boolean;
  itemCount: number;
  items: KnowledgeItem[];
}

export interface KnowledgeItem {
  id: string;
  title: string;
  summary: string;
  type: 'document' | 'code' | 'video' | 'tutorial';
  tags: string[];
  author: string;
  createTime: Date;
  usageCount: number;
}

@Component({
  selector: 'app-knowledge-manager',
  imports: [CommonModule, FormsModule],
  templateUrl: './knowledge-manager.component.html',
  styleUrl: './knowledge-manager.component.scss'
})
export class KnowledgeManagerComponent {
  @Input() knowledgeCategories: KnowledgeCategory[] = [];
  @Input() topKnowledge: any = null;
  @Input() recentKnowledge: any = null;
  @Input() recommendedKnowledge: any = null;

  @Output() addKnowledge = new EventEmitter<void>();
  @Output() importKnowledge = new EventEmitter<void>();
  @Output() searchKnowledge = new EventEmitter<string>();
  @Output() toggleKnowledgeFilter = new EventEmitter<void>();
  @Output() viewKnowledge = new EventEmitter<KnowledgeItem>();
  @Output() editKnowledge = new EventEmitter<KnowledgeItem>();
  @Output() shareKnowledge = new EventEmitter<KnowledgeItem>();

  knowledgeSearchQuery = '';

  onAddKnowledge() {
    this.addKnowledge.emit();
  }

  onImportKnowledge() {
    this.importKnowledge.emit();
  }

  onSearchKnowledge() {
    this.searchKnowledge.emit(this.knowledgeSearchQuery);
  }

  onToggleKnowledgeFilter() {
    this.toggleKnowledgeFilter.emit();
  }

  toggleCategory(category: KnowledgeCategory) {
    category.expanded = !category.expanded;
  }

  getKnowledgeTypeIcon(type: string): string {
    const iconMap: { [key: string]: string } = {
      'document': 'icon-document',
      'code': 'icon-code',
      'video': 'icon-video',
      'tutorial': 'icon-tutorial'
    };
    return iconMap[type] || 'icon-document';
  }

  onViewKnowledge(item: KnowledgeItem) {
    this.viewKnowledge.emit(item);
  }

  onEditKnowledge(item: KnowledgeItem) {
    this.editKnowledge.emit(item);
  }

  onShareKnowledge(item: KnowledgeItem) {
    this.shareKnowledge.emit(item);
  }
}
