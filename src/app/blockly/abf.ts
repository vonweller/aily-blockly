export function processLibraries(libraries: any[]) {
    // let libList = localStorage.getItem('libList')
    // if (libList == null) {
    this.libList = libraries.map(lib => lib.name)
    localStorage.setItem('libList', JSON.stringify(this.libList))
    // } else {
    //     let libList_new: any[] = libraries.map(lib => lib.name)
    //     let libList_old: any[] = JSON.parse(libList)
    //     let result = compareList(libList_old, libList_new)
    //     // 移除已删除的库
    //     result.del.forEach(libName => {
    //         libList_old.splice(libList_old.indexOf(libName), 1)
    //     });
    //     // 添加新增的库
    //     this.libList = libList_old.concat(result.add)
    // }
    let libDict_show = localStorage.getItem('libDict_show')
    if (libDict_show != null) {
        this.libDict_show = JSON.parse(libDict_show)
    }

    libraries.forEach(lib => {
        this.libDict[lib.name] = Object.assign(lib, this.libDict_show[lib.name])
        if (typeof this.libDict[lib.name].show == 'undefined')
            this.libDict[lib.name]['show'] = true
    })

    console.log('libList:', this.libList);
    console.log('libDict:', this.libDict);
}

// 处理json文件中的generator部分
export function processingJsonGenerator(libJson, libName) {
    try {
        libJson.blocks.forEach(blockJson => {
            if (blockJson.generator) {
                let Arduino: any = window['Arduino']
                let getValue: any = window['getValue']
                Arduino[blockJson.type] = (block) => {
                    // 添加宏
                    if (blockJson.generator.macro) {
                        Arduino.addMacro(blockJson.generator.macro, blockJson.generator.macro)
                    }
                    // 添加库
                    if (blockJson.generator.library) {
                        Arduino.addLibrary(blockJson.generator.library, blockJson.generator.library)
                    }
                    // 变量表，用于最后替换变量
                    let VarsDict = {}

                    if (blockJson.args0) {
                        blockJson.args0.forEach(arg => {
                            if (arg.name)
                                VarsDict['${' + arg.name + '}'] = getValue(block, arg.name, arg.type)
                        });
                    }

                    if (blockJson.args1) {
                        blockJson.args1.forEach(arg => {
                            if (arg.name)
                                VarsDict['${' + arg.name + '}'] = getValue(block, arg.name, arg.type)
                        });
                    }
                    if (blockJson.args2) {
                        blockJson.args2.forEach(arg => {
                            if (arg.name)
                                VarsDict['${' + arg.name + '}'] = getValue(block, arg.name, arg.type)
                        });
                    }
                    if (blockJson.args3) {
                        blockJson.args3.forEach(arg => {
                            if (arg.name)
                                VarsDict['${' + arg.name + '}'] = getValue(block, arg.name, arg.type)
                        });
                    }

                    if (blockJson.generator.object) {
                        let primary
                        if (blockJson.generator.primary) primary = processJsonCodeVar(blockJson.generator.primary, VarsDict);
                        let className: string = blockJson.generator.object.split(' ')[0]
                        VarsDict['${OBJECT_NAME}'] = className.toLowerCase() + '_' + primary;
                        let object_code = processJsonCodeVar(blockJson.generator.object, VarsDict)
                        Arduino.addObject(VarsDict['${OBJECT_NAME}'], object_code)
                    }
                    if (blockJson.generator.function) {
                        let functionBody = processJsonCodeVar(blockJson.generator.function, VarsDict)
                        Arduino.addFunction(blockJson.generator.function, functionBody)
                    }
                    if (blockJson.generator.setup) {
                        let setup_code = processJsonCodeVar(blockJson.generator.setup, VarsDict)
                        Arduino.addSetup(VarsDict['${OBJECT_NAME}'], setup_code)
                    }
                    if (blockJson.generator.code) {
                        let code = processJsonCodeVar(blockJson.generator.code, VarsDict)
                        return blockJson.output ? code : code + '\n'
                    } else return '';

                }
            }

            // 判断库是否被用户隐藏
            if (this.libDict_show[libName])
                if (!this.libDict_show[libName].show) {
                    return
                }
            // 如果是按键，直接添加到toolbox
            if (blockJson.kind == 'button') {
                let buttonJson = blockJson
                this.addButtonToCategory(libJson, buttonJson)
                return
            }
            // 添加到toolbox
            if (blockJson.toolbox) {
                if (!blockJson.toolbox.show) return
                this.addBlockToCategory(libJson, blockJson)
            }
        });
    } catch (error) {
        this.message.error(`加载库 ${libName} 失败`)
        this.message.error(error)
        console.log(error);

    }
}

/**
 * 替换json配置中的board相关变量
 * @param {object} sourceJson - 需要处理的JSON对象
 * @returns {object} - 处理后的JSON对象
 */
export function processJsonVar(sourceJson) {
    let jsonString = JSON.stringify(sourceJson)
    let result = jsonString.match(/"\$\{board\.(\S*?)\}"/g)
    if (result != null) {
        // console.log(result);
        result.forEach(item => {
            let itemName = item.replace('"${', '').replace('}"', '')
            // console.log(itemName);
            let data = JSON.parse(JSON.stringify(this.configService.config))
            // console.log(data);
            itemName.split('.').forEach(el => {
                data = data[el]
            })
            jsonString = jsonString.replace(item, JSON.stringify(data))
        });
    }
    return JSON.parse(jsonString)
}

/**
 *  处理json文件中的代码生成中的变量，如：${PIN1}
 */
export function processJsonCodeVar(code: string, vars: object): string {
    // console.log(code, vars)
    for (const varName in vars) {
        let reg = new RegExp('\\' + varName, 'g')
        code = code.replace(reg, vars[varName])
    }
    try {
        code = code.replace(/{{([\s\S]*?)}}/g, function () {
            let str = arguments[1].replace(/\${([\s\S]*?)}(?=|[\s;])/g, function () {
                if (arguments[1] === '') return JSON.stringify(arguments[1]);
                return JSON.stringify(arguments[0]);
            });
            if (str.indexOf('return ') === -1) str = 'return ' + str;
            str = (new Function(str))();
            str = str.replace(/"\${([\s\S]*?)}"(?=|[\s;])/g, function () {
                return arguments[1];
            })
            return str;
        })
    } catch (e) {

    }
    return code
}