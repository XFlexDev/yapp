const { withAppDelegate } = require('expo/config-plugins');

// iOS draws the app card during app switching from the UIWindow, which defaults to light grey. Make it black and dark.
const LINES = '    window?.backgroundColor = .black\n    window?.overrideUserInterfaceStyle = .dark\n';

module.exports = function withBlackWindow(config) {
  return withAppDelegate(config, (c) => {
    let src = c.modResults.contents;
    if (c.modResults.language !== 'swift' || src.includes('window?.backgroundColor = .black')) return c;
    const m = src.match(/^.*window = UIWindow\(.*\)\s*$/m);
    if (m) src = src.replace(m[0], `${m[0]}\n${LINES.trimEnd()}`);
    else src = src.replace(/(\n\s*)return super\.application\(application, didFinishLaunchingWithOptions/, `\n${LINES}$1return super.application(application, didFinishLaunchingWithOptions`);
    c.modResults.contents = src;
    return c;
  });
};
