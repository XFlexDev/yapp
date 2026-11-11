import CoreImage
import CoreImage.CIFilterBuiltins
import ExpoModulesCore
import QuartzCore
import UIKit

/**
 Backdrop blur whose radius goes from `radius` at one edge down to zero at the other.
 Uses the backdrop layer of a UIVisualEffectView with a "variableBlur" filter driven by
 a gradient mask image (same technique as https://github.com/nikstar/VariableBlur, MIT).
 */
public final class YappBlurView: ExpoView {
  private let effectView = UIVisualEffectView(effect: UIBlurEffect(style: .regular))

  var radius: CGFloat = 20 {
    didSet { if radius != oldValue { apply() } }
  }

  var fromBottom = false {
    didSet { if fromBottom != oldValue { apply() } }
  }

  public required init(appContext: AppContext? = nil) {
    super.init(appContext: appContext)
    isUserInteractionEnabled = false
    clipsToBounds = true
    effectView.isUserInteractionEnabled = false
    effectView.frame = bounds
    effectView.autoresizingMask = [.flexibleWidth, .flexibleHeight]
    addSubview(effectView)
    apply()
  }

  private var backdropLayer: CALayer? {
    let views = effectView.subviews
    let match = views.first { NSStringFromClass(type(of: $0)).contains("Backdrop") }
    return (match ?? views.first)?.layer
  }

  private func apply() {
    let name = ["CA", "Filter"].joined()
    guard let filterClass = NSClassFromString(name) as? NSObject.Type else { return }
    let make = NSSelectorFromString("filterWithType:")
    guard let filter = filterClass.perform(make, with: "variableBlur")?.takeUnretainedValue() as? NSObject,
      let mask = maskImage(),
      let layer = backdropLayer
    else { return }

    filter.setValue(radius, forKey: "inputRadius")
    filter.setValue(mask, forKey: "inputMaskImage")
    filter.setValue(true, forKey: "inputNormalizeEdges")
    layer.filters = [filter]

    // Drop the tint/dimming views so only the blur is left.
    for view in effectView.subviews where view.layer !== layer {
      view.alpha = 0
    }
  }

  /// Opaque where the blur is full, clear where it is gone, with a smooth ease between.
  private func maskImage() -> CGImage? {
    let w: CGFloat = 8
    let h: CGFloat = 256
    let gradient = CIFilter.smoothLinearGradient()
    gradient.color0 = CIColor.black
    gradient.color1 = CIColor.clear
    // Core Image has its origin at the bottom left.
    gradient.point0 = CGPoint(x: 0, y: fromBottom ? h * 0.12 : h * 0.88)
    gradient.point1 = CGPoint(x: 0, y: fromBottom ? h : 0)
    guard let output = gradient.outputImage else { return nil }
    return CIContext().createCGImage(output, from: CGRect(x: 0, y: 0, width: w, height: h))
  }

  public override func didMoveToWindow() {
    super.didMoveToWindow()
    // Without this the unblurred end looks pixelated.
    guard let window, let layer = backdropLayer else { return }
    layer.setValue(window.traitCollection.displayScale, forKey: "scale")
  }
}
