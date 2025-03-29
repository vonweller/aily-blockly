!macro customInit
  ; 多种方式尝试关闭可能运行的实例
  nsExec::Exec 'taskkill /F /IM aily-blockly.exe /T'
  nsExec::Exec 'taskkill /F /IM ${PRODUCT_NAME}.exe /T'
  nsExec::Exec 'taskkill /F /IM "Aily Blockly.exe" /T'
  
  ; 等待确保进程完全终止
  Sleep 2000
  
  ; 强制释放可能被锁定的文件
  ${if} ${FileExists} "$INSTDIR"
    ClearErrors
    RMDir /r "$INSTDIR\app"
    RMDir /r "$INSTDIR\locales"
    RMDir /r "$INSTDIR\resources"
    Delete "$INSTDIR\*.dll"
    Delete "$INSTDIR\*.exe"
    Delete "$INSTDIR\*.pak"
    Delete "$INSTDIR\*.bin"
    Delete "$INSTDIR\*.dat"
  ${endif}
  
  ; 最后再等待一下确保文件系统操作完成
  Sleep 1000
!macroend

!macro customInstall
  
  ; 使用7za.exe解压node-v9.11.2-win-x64.7z到node目录
  nsExec::ExecToStack '"$INSTDIR\resources\app\child\7za.exe" x "$INSTDIR\resources\app\child\node-v9.11.2-win-x64.7z" -o"$INSTDIR\resources\app\child\node" -y'
  
  ; 等待解压完成
  Sleep 2000

!macroend

!macro customUnInstall

  Sleep 2000
  ; 尝试删除安装目录本身
  RMDir "$INSTDIR"

!macroend