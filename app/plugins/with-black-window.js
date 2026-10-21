const fs = require('fs');
const path = require('path');
const { withDangerousMod } = require('expo/config-plugins');

// iOS 27 draws the app-switcher card from the UIWindow (created in SceneDelegate), which defaults to light grey.
const HOOK = `  override func scene(_ scene: UIScene, willConnectTo session: UISceneSession, options connectionOptions: UIScene.ConnectionOptions) {
    super.scene(scene, willConnectTo: session, options: connectionOptions)
    window?.backgroundColor = .black
    window?.overrideUserInterfaceStyle = .dark
  }`;

module.exports = function withBlackWindow(config) {
  return withDangerousMod(config, ['ios', (c) => {
    const dir = path.join(c.modRequest.platformProjectRoot, c.modRequest.projectName);
    const file = path.join(dir, 'SceneDelegate.swift');
    if (!fs.existsSync(file)) return c;
    let src = fs.readFileSync(file, 'utf8');
    if (src.includes('window?.backgroundColor = .black')) return c;
    if (!src.includes('import UIKit')) src = `import UIKit\n${src}`;
    src = src.replace('  // Extension point for config plugins.', `  // Extension point for config plugins.\n${HOOK}`);
    fs.writeFileSync(file, src);
    return c;
  }]);
};
