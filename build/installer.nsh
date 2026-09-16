!macro customInstallMode
  ReadRegStr $R0 HKLM "${INSTALL_REGISTRY_KEY}" InstallLocation
  ReadRegStr $R1 HKCU "${INSTALL_REGISTRY_KEY}" InstallLocation
  ${If} $R0 != ""
  ${AndIf} $R1 == ""
    StrCpy $isForceMachineInstall "1"
  ${ElseIf} $R0 == ""
  ${AndIf} $R1 != ""
    StrCpy $isForceCurrentInstall "1"
  ${EndIf}
!macroend

!ifdef BUILD_UNINSTALLER

Var UninstallerSelfName

!macro customRemoveFiles
  Push $R9
  StrCpy $UninstallerSelfName "${UNINSTALL_FILENAME}"
  ${if} ${isUpdated}
    RMDir /r "$PLUGINSDIR\old-install"
    CreateDirectory "$PLUGINSDIR\old-install"

    Push ""
    Call un.moveAsideVolumeSafe
    Pop $R9

    ${if} $R9 != 0
      DetailPrint "File is busy, aborting: $R9"
      Abort `Can't stage "$INSTDIR" for update.`
    ${endif}
  ${endif}

  SetOutPath $TEMP
  RMDir /r $INSTDIR
  Pop $R9
!macroend

Function un.moveAsideVolumeSafe
  Exch $R0
  Push $R1
  Push $R2
  Push $R3

  StrCpy $R3 "$INSTDIR$R0\*.*"
  FindFirst $R1 $R2 $R3

  loop:
    StrCmp $R2 "" break

    StrCmp $R2 "." continue
    StrCmp $R2 ".." continue

    IfFileExists "$INSTDIR$R0\$R2\*.*" isDir isNotDir

    isDir:
      CreateDirectory "$PLUGINSDIR\old-install$R0\$R2"

      Push "$R0\$R2"
      Call un.moveAsideVolumeSafe
      Pop $R3

      StrCmp $R3 0 continue
      Goto done

      Goto continue

    isNotDir:
      StrCmp $R2 $UninstallerSelfName continue

      ClearErrors
      Rename "$INSTDIR$R0\$R2" "$PLUGINSDIR\old-install$R0\$R2"
      IfErrors 0 continue

      ClearErrors
      CopyFiles /SILENT "$INSTDIR$R0\$R2" "$PLUGINSDIR\old-install$R0\$R2"
      IfErrors 0 +3
      StrCpy $R3 "$INSTDIR$R0\$R2"
      Goto done

      ClearErrors
      Delete "$INSTDIR$R0\$R2"
      IfErrors 0 continue

      SetFileAttributes "$INSTDIR$R0\$R2" NORMAL
      ClearErrors
      Delete "$INSTDIR$R0\$R2"
      IfErrors 0 continue

      StrCpy $R3 "$INSTDIR$R0\$R2"
      Goto done

    continue:
      FindNext $R1 $R2
      Goto loop

  break:
    StrCpy $R3 0

  done:
    FindClose $R1

    StrCpy $R0 $R3

    Pop $R3
    Pop $R2
    Pop $R1
    Exch $R0
FunctionEnd

!endif
