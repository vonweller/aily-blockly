import { Component, Input, Output, EventEmitter } from '@angular/core';
import { CommonModule } from '@angular/common';

export interface RequirementStats {
  total: number;
  pending: number;
  inProgress: number;
  completed: number;
}

export interface Requirement {
  id: string;
  title: string;
  description: string;
  status: 'pending' | 'inProgress' | 'completed';
  priority: 'low' | 'medium' | 'high';
  updateTime: Date;
}

@Component({
  selector: 'app-requirements-manager',
  imports: [CommonModule],
  templateUrl: './requirements-manager.component.html',
  styleUrl: './requirements-manager.component.scss'
})
export class RequirementsManagerComponent {
  @Input() requirementStats: RequirementStats = {
    total: 0,
    pending: 0,
    inProgress: 0,
    completed: 0
  };

  @Input() recentRequirements: Requirement[] = [];

  @Output() addRequirement = new EventEmitter<void>();
  @Output() exportRequirements = new EventEmitter<void>();
  @Output() viewAllRequirements = new EventEmitter<void>();
  @Output() editRequirement = new EventEmitter<Requirement>();
  @Output() deleteRequirement = new EventEmitter<Requirement>();

  onAddRequirement() {
    this.addRequirement.emit();
  }

  onExportRequirements() {
    this.exportRequirements.emit();
  }

  onViewAllRequirements() {
    this.viewAllRequirements.emit();
  }

  onEditRequirement(requirement: Requirement) {
    this.editRequirement.emit(requirement);
  }

  onDeleteRequirement(requirement: Requirement) {
    this.deleteRequirement.emit(requirement);
  }
}
