
/**
 * 替换json配置中的board相关变量
 * @param {object} sourceJson - 需要处理的JSON对象
 * @returns {object} - 处理后的JSON对象
 */
export function processJsonVar(sourceJson, boardConfig) {
    let jsonString = JSON.stringify(sourceJson)
    let result = jsonString.match(/"\$\{board\.(\S*?)\}"/g)
    if (result != null) {
        // console.log(result);
        result.forEach(item => {
            let itemName = item.replace('"${', '').replace('}"', '')
            let data = JSON.parse(JSON.stringify(boardConfig))
            data = data[getLastElement(itemName.split('.'))]
            jsonString = jsonString.replace(item, JSON.stringify(data))
        });
    }
    return JSON.parse(jsonString)
}

export function processI18n(sourceJson, i18nData) {
    // 创建blocks的副本，避免修改原始数据
    const updatedBlocks = JSON.parse(JSON.stringify(sourceJson));

    // 遍历blocks数组
    for (let i = 0; i < updatedBlocks.length; i++) {
        const block = updatedBlocks[i];
        const blockType = block.type;

        // 检查i18n中是否有对应类型的块
        if (i18nData[blockType]) {
            // 检查所有可能的message字段
            let messageIndex = 0;
            // 循环检查原始块中的每个messageX字段
            while (block[`message${messageIndex}`] !== undefined) {
                const messageKey = `message${messageIndex}`;

                // 如果i18n数据中存在对应的翻译，则替换
                if (i18nData[blockType][messageKey]) {
                    block[messageKey] = i18nData[blockType][messageKey];
                }

                // 处理args0字段
                const argsKey = `args${messageIndex}`;
                if (block[argsKey] && i18nData[blockType][argsKey]) {
                    // 遍历args数组中的每个元素
                    for (let j = 0; j < block[argsKey].length; j++) {
                        // 确保i18nData中有对应索引的元素且不为null
                        if (i18nData[blockType][argsKey][j] !== undefined &&
                            i18nData[blockType][argsKey][j] !== null) {

                            // 如果是对象，则合并属性
                            if (typeof block[argsKey][j] === 'object' &&
                                block[argsKey][j] !== null &&
                                typeof i18nData[blockType][argsKey][j] === 'object') {

                                // 处理特殊情况：options数组
                                if (block[argsKey][j].options && i18nData[blockType][argsKey][j].options) {
                                    block[argsKey][j].options = i18nData[blockType][argsKey][j].options;
                                } else {
                                    // 合并其他属性
                                    Object.assign(block[argsKey][j], i18nData[blockType][argsKey][j]);
                                }
                            } else {
                                // 直接替换整个元素
                                block[argsKey][j] = i18nData[blockType][argsKey][j];
                            }
                        }
                    }
                }

                // 检查下一个messageX字段
                messageIndex++;
            }
        }
    }
    return updatedBlocks;
}

function getLastElement<T>(array: T[]): T | undefined {
    if (array.length === 0) {
        return undefined;
    }
    return array[array.length - 1];
}