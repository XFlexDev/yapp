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
      val ctx = appContext.reactContext ?: return@Function
      YappAudioService.setActive(ctx, false)
      ctx.stopService(Intent(ctx, YappAudioService::class.java))
    }

    Function("setActive") { active: Boolean ->
      val ctx = appContext.reactContext ?: return@Function
      YappAudioService.setActive(ctx, active)
    }
  }
}
