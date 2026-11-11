import ExpoModulesCore

public final class YappBlurModule: Module {
  public func definition() -> ModuleDefinition {
    Name("YappBlur")

    View(YappBlurView.self) {
      Prop("radius") { (view: YappBlurView, radius: Double) in
        view.radius = CGFloat(radius)
      }

      Prop("edge") { (view: YappBlurView, edge: String) in
        view.fromBottom = edge == "bottom"
      }
    }
  }
}
