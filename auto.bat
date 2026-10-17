@echo off
title Conflict Desert Storm DAT Tool
color 0a

:main
cls
echo === Select Game Version ===
echo.
echo 1. Conflict Desert Storm 1
echo 2. Conflict Desert Storm 2
echo 0. Exit
echo.
set /p ver=Choose version: 

if "%ver%"=="1" goto cds1_menu
if "%ver%"=="2" goto cds2_menu
if "%ver%"=="0" exit
goto main


:: ==========================
:: CDS1 SECTION
:: ==========================
:cds1_menu
cls
set param=--cds
echo === CDS1 DAT Tool ===
echo.
echo 1. Extract Chardata
echo 2. Repack Chardata
echo 3. Extract Catalog
echo 4. Repack Catalog
echo 5. Extract FrontEnd
echo 6. Extract Mission
echo 7. Repack Mission
echo 8. Extract Training
echo 9. Repack Training
echo 0. Back
echo.
set /p choice=Select option: 

if "%choice%"=="1" cdsdat %param% --unlisted chardata.dat --out Chardata
if "%choice%"=="2" cdsdat %param% --new Chardata.dat --add Chardata
if "%choice%"=="3" cdsdat %param% catalog.dat --out Catalog
if "%choice%"=="4" cdsdat %param% --new catalog.dat --add Catalog
if "%choice%"=="5" cdsdat %param% --unlisted FrontEnd.dat --out FrontEnd
if "%choice%"=="6" goto cds1_extract_mission
if "%choice%"=="7" goto cds1_repack_mission
if "%choice%"=="8" goto cds1_extract_training
if "%choice%"=="9" goto cds1_repack_training
if "%choice%"=="0" goto main
pause
goto cds1_menu

:cds1_extract_mission
set /p name=Enter mission name (1,2,3,4,5a,5b,06,7-12b): 
cdsdat %param% --unlisted mission%name%.dat --out Mission%name%
pause
goto cds1_menu

:cds1_repack_mission
set /p name=Enter mission name (1,2,3,4,5a,5b,06,7-12b): 
cdsdat %param% --new mission%name%.dat --add Mission%name%
pause
goto cds1_menu

:cds1_extract_training
set /p name=Enter training number (1–3): 
cdsdat %param% --unlisted training%name%.dat --out Training%name%
pause
goto cds1_menu

:cds1_repack_training
set /p name=Enter training number (1–3): 
cdsdat %param% --new training%name%.dat --add Training%name%
pause
goto cds1_menu


:: ==========================
:: CDS2 SECTION
:: ==========================
:cds2_menu
cls
set param=--cdsii
echo === CDS2 DAT Tool ===
echo.
echo 1. Extract Chardata
echo 2. Repack Chardata
echo 3. Extract Catalog
echo 4. Repack Catalog
echo 5. Extract FrontEnd
echo 6. Extract Mission
echo 7. Repack Mission
echo 8. Extract Training
echo 9. Repack Training
echo 0. Back
echo.
set /p choice=Select option: 

if "%choice%"=="1" cdsdat %param% --unlisted chardata.dat --out Chardata
if "%choice%"=="2" cdsdat %param% --new Chardata.dat --add Chardata
if "%choice%"=="3" cdsdat %param% --unlisted catalog.dat --out Catalog
if "%choice%"=="4" cdsdat %param% --new catalog.dat --add Catalog
if "%choice%"=="5" cdsdat %param% --unlisted FrontEnd.dat --out FrontEnd
if "%choice%"=="6" goto cds2_extract_mission
if "%choice%"=="7" goto cds2_repack_mission
if "%choice%"=="8" goto cds2_extract_training
if "%choice%"=="9" goto cds2_repack_training
if "%choice%"=="0" goto main
pause
goto cds2_menu

:cds2_extract_mission
set /p num=Enter mission number (01–25): 
cdsdat %param% --unlisted mission%num%.dat --out Mission%num%
pause
goto cds2_menu

:cds2_repack_mission
set /p num=Enter mission number (01–25): 
cdsdat %param% --new mission%num%.dat --add Mission%num%
pause
goto cds2_menu

:cds2_extract_training
set /p num=Enter training number (01–04): 
cdsdat %param% --unlisted training%num%.dat --out Training%num%
pause
goto cds2_menu

:cds2_repack_training
set /p num=Enter training number (01–04): 
cdsdat %param% --new training%num%.dat --add Training%num%
pause
goto cds2_menu
