# arduino-cli

## 编译

```
./arduino-cli.exe compile 
    -b aily:renesas_uno_1.3.2:unor4wifi 
    --board-path 'C:\\Users\\stao\\AppData\\Local\\aily-project\\sdk\\renesas_uno_1.3.2' 
    --compile-path 'C:\Users\stao\AppData\Local\aily-project\compiler\arm-none-eabi-gcc@7.2.1'
    --tools-path 'C:\\Users\\stao\\AppData\\Local\\aily-project\\tools' 
    --libraries 'C:\\Users\\stao\\Documents\\Arduino\\libraries'
    --output-dir ./output 
    --log-level debug 
    --verbose 
    ./hello
```

- `-b`: 指定板子型号
- `--board-path`: sdk文件夹
- `--compile-path`: 用到的编译器路径
- `--tools-path`: 工具路径
- `--output-dir`: 编译后文件输出文件夹

## 上传

```
./arduino-cli.exe upload 
    -b aily:renesas_uno_1.3.2:unor4wifi 
    --board-path 'C:\\Users\\stao\\AppData\\Local\\aily-project\\sdk\\renesas_uno_1.3.2' 
    --tools-path 'C:\\Users\\stao\\AppData\\Local\\aily-project\\tools' 
    --input-dir ./output 
    -p 'COM5'
```

- `--input-dir`: 编译时指定的输出文件夹路径（`--output`）
- `-p`: 端口
- `-b`: 板子型号
- `--board-path`: sdk文件夹
- `--tools-path`: 工具文件夹
