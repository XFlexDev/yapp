package dev.kreatix.yappbg

import android.content.Intent
import androidx.core.content.ContextCompat
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.ReactContext
import com.facebook.react.bridge.UiThreadUtil
import com.facebook.react.jstasks.HeadlessJsTaskConfig
import com.facebook.react.jstasks.HeadlessJsTaskContext
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class YappBackgroundModule : Module() {
  private var task = 0

  // React Native stops JS timers once the app leaves the screen unless a headless task is running.
  // LiveKit's signalling runs on those timers, so without this nothing is heard in the background.
  private fun keepJsAwake(on: Boolean) {
    val rc = appContext.reactContext as? ReactContext ?: return
    UiThreadUtil.runOnUiThread {
      try {
        val tasks = HeadlessJsTaskContext.getInstance(rc)
        if (on) {
          if (task == 0 || !tasks.isTaskRunning(task)) {
            task = tasks.startTask(HeadlessJsTaskConfig("YappKeepAlive", Arguments.createMap(), 0, true))
          }
        } else if (task != 0) {
          if (tasks.isTaskRunning(task)) tasks.finishTask(task)
          task = 0
        }
      } catch (e: Exception) {
      }
    }
  }

  override fun definition() = ModuleDefinition {
    Name("YappBackground")

    Function("start") { title: String, text: String ->
      val ctx = appContext.reactContext ?: return@Function false
      try {
        ContextCompat.startForegroundService(ctx, Intent(ctx, YappAudioService::class.java).putExtra("title", title).putExtra("text", text))
        keepJsAwake(true)
        true
      } catch (e: Exception) {
        false
      }
    }

    Function("stop") {
      val ctx = appContext.reactContext ?: return@Function null
      keepJsAwake(false)
      YappAudioService.setActive(ctx, false)
      ctx.stopService(Intent(ctx, YappAudioService::class.java))
    }

    Function("isBatteryExcluded") {
      val ctx = appContext.reactContext ?: return@Function false
      val pm = ctx.getSystemService(android.content.Context.POWER_SERVICE) as android.os.PowerManager
      pm.isIgnoringBatteryOptimizations(ctx.packageName)
    }

    Function("excludeBattery") {
      val ctx = appContext.reactContext ?: return@Function false
      try {
        val i = Intent(android.provider.Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS)
        i.data = android.net.Uri.parse("package:" + ctx.packageName)
        i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        ctx.startActivity(i)
        true
      } catch (e: Exception) {
        try {
          val i = Intent(android.provider.Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS)
          i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
          ctx.startActivity(i)
          true
        } catch (e2: Exception) { false }
      }
    }

    Function("openAppSettings") {
      val ctx = appContext.reactContext ?: return@Function false
      try {
        val i = Intent(android.provider.Settings.ACTION_APPLICATION_DETAILS_SETTINGS)
        i.data = android.net.Uri.parse("package:" + ctx.packageName)
        i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        ctx.startActivity(i)
        true
      } catch (e: Exception) { false }
    }

    Function("setActive") { active: Boolean ->
      val ctx = appContext.reactContext ?: return@Function null
      YappAudioService.setActive(ctx, active)
    }
  }
}
