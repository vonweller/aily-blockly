import { Component, ElementRef, Input, OnInit, SimpleChanges, ViewChild } from '@angular/core';
import { createChart, IChartApi, ISeriesApi, LineSeriesPartialOptions, UTCTimestamp } from 'lightweight-charts';
import { BehaviorSubject } from 'rxjs';

@Component({
  selector: 'line-chart-area',
  templateUrl: './line-chart-area.component.html',
  styleUrls: ['./line-chart-area.component.scss']
})
export class LineChartAreaComponent implements OnInit {

  loaded = new BehaviorSubject(false)

  @Input() data;
  @Input() color;
  @Input() quickCode = "1h";

  @ViewChild('chart') chartContainer: ElementRef;
  private chart: IChartApi;
  private areaSeries: ISeriesApi<"Area">;
  private intervalTimer: any;

  constructor() { }

  ngOnInit(): void {
  }

  ngAfterViewInit(): void {
    this.darwChart();
  }

  ngOnDestroy(): void {
    if (this.intervalTimer) {
      clearInterval(this.intervalTimer);
    }
    if (this.chart) {
      this.chart.remove();
    }
  }

  ngOnChanges(changes: SimpleChanges) {
    if (typeof changes['data'] != 'undefined') {
      let subscription = this.loaded.subscribe(result => {
        if (result) {
          setTimeout(() => {
            this.updateData()
            subscription.unsubscribe()
          }, 10)
        }
      })
    }
    if (typeof changes['color'] != 'undefined') {
      setTimeout(() => {
        this.darwChart()
      }, 10)
    }
  }

  darwChart() {
    if (this.chart) {
      this.chart.remove();
    }
    this.chart = createChart(this.chartContainer.nativeElement, {
      width: this.chartContainer.nativeElement.offsetWidth,
      layout: {
        textColor: 'rgba(0, 0, 0, 0.45)',
        fontSize: 10,
      },
      grid: {
        vertLines: {
          color: 'rgba(0, 0, 0, 0.1)',
        },
        horzLines: {
          color: 'rgba(0, 0, 0, 0.1)',
        },
      },
      timeScale: {
        timeVisible: true,
        secondsVisible: false,
        borderColor: 'rgba(0, 0, 0, 0.3)'
      },
      rightPriceScale: {
        borderColor: 'rgba(0, 0, 0, 0.3)'
      }
    });
    const lineSeriesOptions: LineSeriesPartialOptions = {};
    this.areaSeries = this.chart.addAreaSeries(lineSeriesOptions);
    this.loaded.next(true)
  }

  updateData() {
    let dataList: any = [{ value: 0, time: 1642425322 }, { value: 8, time: 1642511722 }, { value: 10, time: 1642598122 }, { value: 20, time: 1642684522 }, { value: 3, time: 1642770922 }, { value: 43, time: 1642857322 }, { value: 41, time: 1642943722 }, { value: 43, time: 1643030122 }, { value: 56, time: 1643116522 }, { value: 46, time: 1643202922 }];
    this.areaSeries.applyOptions({
      lineColor: this.color,
      // topColor: color2Rgba(this.color, 0.6),
      bottomColor: '#fff',
      lineWidth: 2
    })
    this.areaSeries.setData(dataList);
  }
}
