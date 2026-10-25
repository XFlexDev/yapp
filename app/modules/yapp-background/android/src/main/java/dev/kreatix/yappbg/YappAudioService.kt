package dev.kreatix.yappbg

import android.Manifest
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.content.pm.ServiceInfo
import android.net.wifi.WifiManager
import android.os.Build
import android.os.IBinder
import android.os.PowerManager
import androidx.core.app.NotificationCompat
import androidx.core.content.ContextCompat

/**
 * Keeps Yapp's process alive while signed in so friends' voice keeps playing with the screen off
 * or the app in the background. A wake lock is only held while audio is actually flowing.
 */
class YappAudioService : Service() {
  override fun onBind(intent: Intent?): IBinder? = null

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    val title = intent?.getStringExtra("title") ?: "Yapp"
    val text = intent?.getStringExtra("text") ?: "Friends can talk to you"
    val nm = getSystemService(NotificationManager::class.java)
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      nm.createNotificationChannel(
        NotificationChannel(CHANNEL, "Walkie-talkie", NotificationManager.IMPORTANCE_LOW).apply {
          setShowBadge(false)
          setSound(null, null)
        }
      )
    }
    val launch = packageManager.getLaunchIntentForPackage(packageName)
    val tap = launch?.let { PendingIntent.getActivity(this, 0, it, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT) }
    val n = NotificationCompat.Builder(this, CHANNEL)
      .setContentTitle(title)
      .setContentText(text)
      .setSmallIcon(applicationInfo.icon)
      .setOngoing(true)
      .setSilent(true)
      .setContentIntent(tap)
      .setCategory(NotificationCompat.CATEGORY_SERVICE)
      .setPriority(NotificationCompat.PRIORITY_LOW)
      .setForegroundServiceBehavior(NotificationCompat.FOREGROUND_SERVICE_IMMEDIATE)
      .build()
    try {
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
        val mic = ContextCompat.checkSelfPermission(this, Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED
        var type = ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK
        if (mic) type = type or ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE
        try {
          startForeground(ID, n, type)
        } catch (e: Exception) {
          startForeground(ID, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK)
        }
      } else {
        startForeground(ID, n)
      }
    } catch (e: Exception) {
      stopSelf()
      return START_STICKY
    }
    if (wifi == null) {
      wifi = (applicationContext.getSystemService(Context.WIFI_SERVICE) as WifiManager)
        .createWifiLock(WifiManager.WIFI_MODE_FULL_HIGH_PERF, "yapp:voice").apply { setReferenceCounted(false); acquire() }
    }
    return START_STICKY
  }

  override fun onTimeout(startId: Int, fgsType: Int) {
    stopSelf()
  }

  override fun onDestroy() {
    wifi?.let { if (it.isHeld) it.release() }
    wifi = null
    setActive(this, false)
    super.onDestroy()
  }

  companion object {
    private const val CHANNEL = "yapp_voice"
    private const val ID = 4207
    private var wifi: WifiManager.WifiLock? = null
    private var wake: PowerManager.WakeLock? = null

    fun setActive(ctx: Context, active: Boolean) {
      if (active) {
        val w = wake ?: (ctx.applicationContext.getSystemService(Context.POWER_SERVICE) as PowerManager)
          .newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "yapp:talking").apply { setReferenceCounted(false) }
        wake = w
        // Bounded so a missed "stopped" event can never pin the CPU awake.
        w.acquire(10 * 60 * 1000L)
      } else {
        wake?.let { if (it.isHeld) it.release() }
      }
    }
  }
}
