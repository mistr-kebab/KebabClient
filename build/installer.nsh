!macro customInstallMode
  # Merkt sich die Installationsart (alle User / nur ich) aus einer
  # frueheren Installation und ueberspringt dadurch die Modus-Seite.
  # - Nur ein Scope gefunden -> Modus erzwingen, Seite wird per Abort uebersprungen.
  # - Kein Scope (Neuinstallation) oder beide Scopes -> Dialog wie bisher.
  # Gilt fuer Installer und Uninstaller (Hook aus multiUserUi.nsh).
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
