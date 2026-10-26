; Elektron – registriert den Browser bei Windows, damit er als Standardbrowser
; unter "Einstellungen > Apps > Standard-Apps" auswählbar ist.
!define EGX_KEY "Software\Clients\StartMenuInternet\ElektronGX"

!macro customInstall
  WriteRegStr HKCU "${EGX_KEY}" "" "Elektron"
  WriteRegStr HKCU "${EGX_KEY}\DefaultIcon" "" "$INSTDIR\Elektron.exe,0"
  WriteRegStr HKCU "${EGX_KEY}\shell\open\command" "" '"$INSTDIR\Elektron.exe"'
  WriteRegStr HKCU "${EGX_KEY}\Capabilities" "ApplicationName" "Elektron"
  WriteRegStr HKCU "${EGX_KEY}\Capabilities" "ApplicationDescription" "Elektron – der Gaming-Browser"
  WriteRegStr HKCU "${EGX_KEY}\Capabilities" "ApplicationIcon" "$INSTDIR\Elektron.exe,0"
  WriteRegStr HKCU "${EGX_KEY}\Capabilities\URLAssociations" "http" "ElektronGXURL"
  WriteRegStr HKCU "${EGX_KEY}\Capabilities\URLAssociations" "https" "ElektronGXURL"
  WriteRegStr HKCU "${EGX_KEY}\Capabilities\FileAssociations" ".htm" "ElektronGXHTML"
  WriteRegStr HKCU "${EGX_KEY}\Capabilities\FileAssociations" ".html" "ElektronGXHTML"
  WriteRegStr HKCU "${EGX_KEY}\Capabilities\FileAssociations" ".pdf" "ElektronGXHTML"
  WriteRegStr HKCU "${EGX_KEY}\Capabilities\StartMenu" "StartMenuInternet" "ElektronGX"

  WriteRegStr HKCU "Software\Classes\ElektronGXURL" "" "Elektron URL"
  WriteRegStr HKCU "Software\Classes\ElektronGXURL" "URL Protocol" ""
  WriteRegStr HKCU "Software\Classes\ElektronGXURL\DefaultIcon" "" "$INSTDIR\Elektron.exe,0"
  WriteRegStr HKCU "Software\Classes\ElektronGXURL\shell\open\command" "" '"$INSTDIR\Elektron.exe" "%1"'

  WriteRegStr HKCU "Software\Classes\ElektronGXHTML" "" "Elektron Dokument"
  WriteRegStr HKCU "Software\Classes\ElektronGXHTML\DefaultIcon" "" "$INSTDIR\Elektron.exe,0"
  WriteRegStr HKCU "Software\Classes\ElektronGXHTML\shell\open\command" "" '"$INSTDIR\Elektron.exe" "%1"'

  DeleteRegValue HKCU "Software\RegisteredApplications" "Elektron GX"
  WriteRegStr HKCU "Software\RegisteredApplications" "Elektron" "${EGX_KEY}\Capabilities"
!macroend

!macro customUnInstall
  DeleteRegKey HKCU "${EGX_KEY}"
  DeleteRegKey HKCU "Software\Classes\ElektronGXURL"
  DeleteRegKey HKCU "Software\Classes\ElektronGXHTML"
  DeleteRegValue HKCU "Software\RegisteredApplications" "Elektron"
  DeleteRegValue HKCU "Software\RegisteredApplications" "Elektron GX"
!macroend
