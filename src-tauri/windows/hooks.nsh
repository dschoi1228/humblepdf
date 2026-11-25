; Installer hooks (D46): register HumblePDF as an app that can open PDF files, without taking
; over the default. Windows 11 lets only the user choose the default app; these keys put
; HumblePDF in "Open with" and in Settings > Apps > Default apps. Everything is per user
; (HKCU), matching the per-user install, and is removed on uninstall.

!define HP_PROGID "HumblePDF.Document"
!define HP_CAPS "Software\HumblePDF\Capabilities"

!macro NSIS_HOOK_POSTINSTALL
  ; The file type HumblePDF opens.
  WriteRegStr HKCU "Software\Classes\${HP_PROGID}" "" "PDF"
  WriteRegStr HKCU "Software\Classes\${HP_PROGID}\DefaultIcon" "" "$INSTDIR\${MAINBINARYNAME}.exe,0"
  WriteRegStr HKCU "Software\Classes\${HP_PROGID}\shell\open\command" "" '"$INSTDIR\${MAINBINARYNAME}.exe" "%1"'
  ; Offered for .pdf in "Open with"; the default value of .pdf is left alone.
  WriteRegStr HKCU "Software\Classes\.pdf\OpenWithProgids" "${HP_PROGID}" ""
  ; Listed in Default apps.
  WriteRegStr HKCU "${HP_CAPS}" "ApplicationName" "HumblePDF"
  WriteRegStr HKCU "${HP_CAPS}" "ApplicationDescription" "Merge, sign and mark up PDF files."
  WriteRegStr HKCU "${HP_CAPS}" "ApplicationIcon" "$INSTDIR\${MAINBINARYNAME}.exe,0"
  WriteRegStr HKCU "${HP_CAPS}\FileAssociations" ".pdf" "${HP_PROGID}"
  WriteRegStr HKCU "Software\RegisteredApplications" "HumblePDF" "${HP_CAPS}"
  ; SHCNE_ASSOCCHANGED: Explorer picks up the new entries.
  System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0, p 0, p 0)'
!macroend

!macro NSIS_HOOK_POSTUNINSTALL
  DeleteRegValue HKCU "Software\RegisteredApplications" "HumblePDF"
  DeleteRegKey HKCU "Software\HumblePDF\Capabilities"
  DeleteRegKey /ifempty HKCU "Software\HumblePDF"
  DeleteRegValue HKCU "Software\Classes\.pdf\OpenWithProgids" "${HP_PROGID}"
  DeleteRegKey HKCU "Software\Classes\${HP_PROGID}"
  System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0, p 0, p 0)'
!macroend
