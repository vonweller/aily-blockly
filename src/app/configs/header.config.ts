export let HEADER_BTNS: IHeaderMenuItem[][] = [
  [
    {
      name: '编译',
      action: 'Project_build',
      icon: 'fa-light fa-arrows-rotate',
      color: '#34a5ff',
    },
    {
      name: '上传',
      action: 'Project_upload',
      icon: 'fa-light fa-play',
      color: '#009d12',
    },
  ],
  [
    {
      name: '查看代码',
      action: 'open-code-viewer',
      icon: 'fa-light fa-file-code',
    },
    {
      name: '串口工具',
      action: 'open-serial-monitor',
      icon: 'fa-light fa-monitor-waveform',
    },
    {
      name: '终端',
      action: 'open-terminal',
      icon: 'fa-light fa-rectangle-terminal',
    },
    {
      name: '课程',
      action: 'Classroom_open',
      icon: 'fa-light fa-graduation-cap',
    },
    {
      name: 'AI',
      action: 'Setting_open',
      icon: 'fa-regular fa-star-christmas',
      more: 'AI',
    },
    {
      name: '更多',
      action: 'more',
      icon: 'fa-regular fa-ellipsis-vertical',
    },
  ],
];

interface IHeaderMenuItem {
  name: string;
  action: string;
  data?: string;
  icon: string;
  color?: string;
  more?: string;
}

export let HEADER_MENU = [
  {
    name: '新建项目',
    action: 'open-window',
    data: { path: 'project-new', alwaysOnTop: true, width: 700, height: 550 },
    icon: 'fa-light fa-file',
  },
  {
    name: '打开项目',
    action: 'project-open',
    icon: 'fa-light fa-folder-open',
  },
  {
    name: '保存项目',
    action: 'project-save',
    icon: 'fa-light fa-file-check',
  },
  {
    name: '另存为',
    action: 'project-save-as',
    icon: 'fa-light fa-copy',
  },
  {
    sep: true,
  },
  {
    name: '在资源管理器打开',
    action: 'explorer-open',
    icon: 'fa-light fa-browser',
  },
  {
    name: '导出代码',
    action: 'code-export',
    icon: 'fa-light fa-square-code',
  },
  {
    sep: true,
  },
  {
    name: '设置',
    action: 'open-window',
    data: { path: 'settings', alwaysOnTop: true },
    icon: 'fa-light fa-gear',
  },
  {
    sep: true,
  },
  {
    name: '退出',
    action: 'app-exit',
    icon: 'fa-light fa-xmark',
  },
];
