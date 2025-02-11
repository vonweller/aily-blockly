export let HEADER_BTNS:IHeaderMenuItem[][] = [
  // [
  //     {
  //         name: 'Aily',
  //         action: 'open-aily-chat',
  //         icon: 'fa-light fa-message-bot'
  //     }
  // ], [
  //     {
  //         name: '打开工程',
  //         action: 'Project_open',
  //         icon: 'fa-light fa-folder-open'
  //     },
  //     {
  //         name: '新建工程',
  //         action: 'Project_new',
  //         icon: 'fa-light fa-file-circle-plus'
  //     },
  //     {
  //         name: '保存工程',
  //         action: 'Project_save',
  //         icon: 'fa-light fa-file-export'
  //     }
  // ],
  [
    // {
    //     name: '设备',
    //     action: 'Device_connect',
    //     icon: 'fa-light fa-microchip',
    //     device: true
    // },
    {
      name: '编译',
      action: 'open-prj-builder',
      icon: 'fa-light fa-arrows-rotate',
      color: '#34a5ff',
    },
    {
      name: '上传',
      action: 'open-prj-uploader',
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
  ],
  [
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
  ],
];

interface IHeaderMenuItem {
  name: string;
  action: string;
  icon: string;
  color?: string;
  more?: string;
}

export let HEADER_MENU = [
  {
    name: '新建项目',
    action: 'Project_new',
    icon: 'fa-light fa-file',
  },
  {
    name: '打开项目',
    action: 'Project_open',
    icon: 'fa-light fa-folder-open',
  },
  {
    name: '保存项目',
    action: 'Project_save',
    icon: 'fa-light fa-file-check',
  },
  {
    name: '另存为',
    action: 'Project_save2',
    icon: 'fa-light fa-copy',
  },
  {
    sep: true,
  },
  {
    name: '在资源管理器打开',
    action: 'Code_export',
    icon: 'fa-light fa-browser',
  },
  {
    name: '导出代码',
    action: 'Code_export',
    icon: 'fa-light fa-square-code',
  },
  {
    sep: true,
  },
  {
    name: '设置',
    action: 'Project_upload',
    icon: 'fa-light fa-gear',
  },
  {
    sep: true,
  },
  {
    name: '退出',
    action: 'Project_upload',
    icon: 'fa-light fa-xmark',
  },
];
