import { icons } from "blockly";

export let HEADER_MENU = [
    [
        {
            name: 'Aily',
            action: 'AI_open',
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
            action: 'Code_open',
            icon: 'fa-light fa-file-code'
        },
        {
            name: '串口工具',
            action: 'Tool_serial',
            icon: 'fa-light fa-monitor-waveform'
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