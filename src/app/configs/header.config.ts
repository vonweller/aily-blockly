export let HEADER_MENU = [
    [
        {
            name: 'Aily',
            action: 'open-aily-chat',
            icon: 'fa-light fa-message-bot'
        }
    ], [
        {
            name: '打开工程',
            action: 'Project_open',
            icon: 'fa-light fa-folder-open'
        },
        {
            name: '新建工程',
            action: 'Project_new',
            icon: 'fa-light fa-file-circle-plus'
        },
        {
            name: '保存工程',
            action: 'Project_save',
            icon: 'fa-light fa-file-export'
        }
    ], [
        {
            name: '设备',
            action: 'Device_connect',
            icon: 'fa-light fa-microchip',
            device: true
        },
        {
            name: '编译',
            action: 'Project_build',
            icon: 'fa-light fa-wrench'
        },
        {
            name: '上传',
            action: 'Project_upload',
            icon: 'fa-light fa-download'
        }
    ], [
        {
            name: '查看代码',
            action: 'open-code-viewer',
            icon: 'fa-light fa-file-code'
        },
        {
            name: '串口工具',
            action: 'open-serial-monitor',
            icon: 'fa-light fa-monitor-waveform'
        },
        {
            name: '终端',
            action: 'open-terminal',
            icon: 'fa-light fa-rectangle-terminal'
        },
    ], [
        {
            name: '课程',
            action: 'Classroom_open',
            icon: 'fa-light fa-graduation-cap'
        },
        {
            name: '设置',
            action: 'Setting_open',
            icon: 'fa-light fa-gear'
        }
    ]
]