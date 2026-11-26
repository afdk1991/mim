# 注册/更新 Windows 每日定时任务（本机开发/备用机方案）
# 生产服务器请改用 deploy/mim-catalog.timer 或 deploy/catalog-cron。
# 幂等：重复执行只会覆盖同名任务，不会产生重复计划。
# 执行：powershell -ExecutionPolicy Bypass -File scripts\catalog\install-schedule.ps1
$ErrorActionPreference = 'Stop'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$repo = Resolve-Path (Join-Path $here '..\..')
$script = Join-Path $here 'run-daily.ps1'
$taskName = 'MimCatalogDailySync'

$action = New-ScheduledTaskAction -Execute 'powershell.exe' `
  -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$script`"" `
  -WorkingDirectory $repo
$trigger = New-ScheduledTaskTrigger -Daily -At '02:30'
$settings = New-ScheduledTaskSettingsSet `
  -StartWhenAvailable `
  -DontStopOnIdleEnd `
  -ExecutionTimeLimit (New-TimeSpan -Hours 6) `
  -MultipleInstances IgnoreNew
$principal = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" -LogonType Interactive -RunLevel Limited

Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Settings $settings -Principal $principal `
  -Description 'Mim 全量商城每日 02:30 自动续抓（egluosi，幂等累积到全量）' -Force | Out-Null

$info = Get-ScheduledTask -TaskName $taskName
$next = (Get-ScheduledTaskInfo -TaskName $taskName).NextRunTime
"已注册任务：$taskName"
"状态：$($info.State)"
"下次运行：$next"
