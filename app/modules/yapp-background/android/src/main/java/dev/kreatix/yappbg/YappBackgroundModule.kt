package dev.kreatix.yappbg

import android.content.Intent
import androidx.core.content.ContextCompat
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class YappBackgroundModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("YappBackground")

    Function("start") { title: String, text: String ->
      val ctx = appContext.reactContext ?: return@Function false
      try {
        ContextCompat.startForegroundService(ctx, Intent(ctx, YappAudioService::class.java).putExtra("title", title).putExtra("text", text))
        true
      } catch (e: Exception) {
        false
      }
    }

    Function("stop") {
      val ctx = appContext.reactContext ?: return@Function null
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

    Function("setActive") { active: Boolean ->
      val ctx = appContext.reactContext ?: return@Function null
      YappAudioService.setActive(ctx, active)
    }
  }
}
