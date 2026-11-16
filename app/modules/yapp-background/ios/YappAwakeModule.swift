import CoreLocation
import ExpoModulesCore

/// Holds a coarse location session open so iOS keeps the app running in the background.
/// Locations are never read, stored or sent.
final class AwakeKeeper: NSObject, CLLocationManagerDelegate {
  static let shared = AwakeKeeper()
  private let manager = CLLocationManager()
  private var wanted = false
  private var running = false

  private override init() {
    super.init()
    manager.delegate = self
    manager.desiredAccuracy = kCLLocationAccuracyThreeKilometers
    manager.distanceFilter = 3000
    manager.pausesLocationUpdatesAutomatically = false
    manager.activityType = .other
  }

  // Setting allowsBackgroundLocationUpdates without the background mode crashes the app.
  private var hasBackgroundMode: Bool {
    let modes = Bundle.main.object(forInfoDictionaryKey: "UIBackgroundModes") as? [String]
    return modes?.contains("location") ?? false
  }

  var state: String {
    switch manager.authorizationStatus {
    case .notDetermined:
      return "ask"
    case .authorizedAlways, .authorizedWhenInUse:
      return running ? "on" : "off"
    default:
      return "denied"
    }
  }

  func start() {
    wanted = true
    apply()
  }

  func stop() {
    wanted = false
    apply()
  }

  private func apply() {
    let status = manager.authorizationStatus
    let allowed = status == .authorizedAlways || status == .authorizedWhenInUse
    if wanted && status == .notDetermined {
      manager.requestAlwaysAuthorization()
      return
    }
    if wanted && allowed && hasBackgroundMode {
      if running { return }
      manager.allowsBackgroundLocationUpdates = true
      manager.showsBackgroundLocationIndicator = false
      manager.startUpdatingLocation()
      running = true
    } else if running {
      manager.stopUpdatingLocation()
      manager.allowsBackgroundLocationUpdates = false
      running = false
    }
  }

  func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
    apply()
  }

  func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {}

  func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {}
}

public class YappAwakeModule: Module {
  public func definition() -> ModuleDefinition {
    Name("YappAwake")

    AsyncFunction("start") { () -> String in
      AwakeKeeper.shared.start()
      return AwakeKeeper.shared.state
    }
    .runOnQueue(.main)

    AsyncFunction("stop") {
      AwakeKeeper.shared.stop()
    }
    .runOnQueue(.main)

    AsyncFunction("state") { () -> String in
      return AwakeKeeper.shared.state
    }
    .runOnQueue(.main)
  }
}
