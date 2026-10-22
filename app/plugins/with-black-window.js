const fs = require('fs');
const path = require('path');
const { withAppDelegate, withDangerousMod } = require('expo/config-plugins');

const LINES = `    window?.backgroundColor = .black
    window?.overrideUserInterfaceStyle = .dark
    rootViewController?.view.backgroundColor = .black
`;

const HOOK = `  override func scene(_ scene: UIScene, willConnectTo session: UISceneSession, options connectionOptions: UIScene.ConnectionOptions) {
    super.scene(scene, willConnectTo: session, options: connectionOptions)
    window?.backgroundColor = .black
    window?.overrideUserInterfaceStyle = .dark
    window?.rootViewController?.view.backgroundColor = .black
  }`;

module.exports = function withBlackWindow(config) {
  // 1. SceneDelegate.swift for UIScene lifecycle
  config = withDangerousMod(config, ['ios', (c) => {
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

  // 2. AppDelegate.swift fallback
  config = withAppDelegate(config, (c) => {
    let src = c.modResults.contents;
    if (c.modResults.language !== 'swift' || src.includes('window?.backgroundColor = .black')) return c;
    const m = src.match(/^.*window = UIWindow\(.*\)\s*$/m);
    if (m) src = src.replace(m[0], `${m[0]}\n${LINES.trimEnd()}`);
    else src = src.replace(/(\n\s*)return super\.application\(application, didFinishLaunchingWithOptions/, `\n${LINES}$1return super.application(application, didFinishLaunchingWithOptions`);
    c.modResults.contents = src;
    return c;
  });

  return config;
};


