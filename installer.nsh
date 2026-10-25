; Elektron GX – registriert den Browser bei Windows, damit er als Standardbrowser
; unter "Einstellungen > Apps > Standard-Apps" auswählbar ist.
!define EGX_KEY "Software\Clients\StartMenuInternet\ElektronGX"

!macro customInstall
  WriteRegStr HKCU "${EGX_KEY}" "" "Elektron GX"
  WriteRegStr HKCU "${EGX_KEY}\DefaultIcon" "" "$INSTDIR\Elektron GX.exe,0"
  WriteRegStr HKCU "${EGX_KEY}\shell\open\command" "" '"$INSTDIR\Elektron GX.exe"'
  WriteRegStr HKCU "${EGX_KEY}\Capabilities" "ApplicationName" "Elektron GX"
  WriteRegStr HKCU "${EGX_KEY}\Capabilities" "ApplicationDescription" "Elektron GX – der Gaming-Browser"
  WriteRegStr HKCU "${EGX_KEY}\Capabilities" "ApplicationIcon" "$INSTDIR\Elektron GX.exe,0"
  WriteRegStr HKCU "${EGX_KEY}\Capabilities\URLAssociations" "http" "ElektronGXURL"
  WriteRegStr HKCU "${EGX_KEY}\Capabilities\URLAssociations" "https" "ElektronGXURL"
  WriteRegStr HKCU "${EGX_KEY}\Capabilities\FileAssociations" ".htm" "ElektronGXHTML"
  WriteRegStr HKCU "${EGX_KEY}\Capabilities\FileAssociations" ".html" "ElektronGXHTML"
  WriteRegStr HKCU "${EGX_KEY}\Capabilities\FileAssociations" ".pdf" "ElektronGXHTML"
  WriteRegStr HKCU "${EGX_KEY}\Capabilities\StartMenu" "StartMenuInternet" "ElektronGX"

  WriteRegStr HKCU "Software\Classes\ElektronGXURL" "" "Elektron GX URL"
  WriteRegStr HKCU "Software\Classes\ElektronGXURL" "URL Protocol" ""
  WriteRegStr HKCU "Software\Classes\ElektronGXURL\DefaultIcon" "" "$INSTDIR\Elektron GX.exe,0"
  WriteRegStr HKCU "Software\Classes\ElektronGXURL\shell\open\command" "" '"$INSTDIR\Elektron GX.exe" "%1"'

  WriteRegStr HKCU "Software\Classes\ElektronGXHTML" "" "Elektron GX Dokument"
  WriteRegStr HKCU "Software\Classes\ElektronGXHTML\DefaultIcon" "" "$INSTDIR\Elektron GX.exe,0"
  WriteRegStr HKCU "Software\Classes\ElektronGXHTML\shell\open\command" "" '"$INSTDIR\Elektron GX.exe" "%1"'

  WriteRegStr HKCU "Software\RegisteredApplications" "Elektron GX" "${EGX_KEY}\Capabilities"
!macroend

!macro customUnInstall
  DeleteRegKey HKCU "${EGX_KEY}"
  DeleteRegKey HKCU "Software\Classes\ElektronGXURL"
  DeleteRegKey HKCU "Software\Classes\ElektronGXHTML"
  DeleteRegValue HKCU "Software\RegisteredApplications" "Elektron GX"
!macroend
