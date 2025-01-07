import { Component } from '@angular/core';
import { LineChartAreaComponent } from '../../components/line-chart-area/line-chart-area.component';

@Component({
  selector: 'app-data-chart',
  imports: [
    LineChartAreaComponent
  ],
  templateUrl: './data-chart.component.html',
  styleUrl: './data-chart.component.scss'
})
export class DataChartComponent {

  data = [{ value: 0, time: 1642425322 }, { value: 8, time: 1642511722 }, { value: 10, time: 1642598122 }, { value: 20, time: 1642684522 }, { value: 3, time: 1642770922 }, { value: 43, time: 1642857322 }, { value: 41, time: 1642943722 }, { value: 43, time: 1643030122 }, { value: 56, time: 1643116522 }, { value: 46, time: 1643202922 }];
}
