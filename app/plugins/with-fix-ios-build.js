const { withDangerousMod, withXcodeProject } = require('expo/config-plugins');
const fs = require('fs');
const path = require('path');

module.exports = function withFixIosBuild(config) {
  // 1. Xcode project build settings
  config = withXcodeProject(config, (c) => {
    const xcodeProject = c.modResults;
    const configurations = xcodeProject.pbxXCBuildConfigurationSection();
    for (const key in configurations) {
      if (typeof configurations[key] === 'object' && configurations[key].buildSettings) {
        configurations[key].buildSettings.ENABLE_USER_SCRIPT_SANDBOXING = 'NO';
      }
    }
    return c;
  });

  // 2. Podfile hook & patch build-xcframework.sh
  config = withDangerousMod(config, [
    'ios',
    (c) => {
      const iosDir = c.modRequest.platformProjectRoot;
      const podfilePath = path.join(iosDir, 'Podfile');

      // Patch Podfile post_install
      if (fs.existsSync(podfilePath)) {
        let podfile = fs.readFileSync(podfilePath, 'utf8');
        const hook = `
    installer.pods_project.targets.each do |target|
      target.build_configurations.each do |config|
        config.build_settings['ENABLE_USER_SCRIPT_SANDBOXING'] = 'NO'
      end
    end
`;
        if (!podfile.includes('ENABLE_USER_SCRIPT_SANDBOXING')) {
          if (podfile.includes('post_install do |installer|')) {
            podfile = podfile.replace('post_install do |installer|', `post_install do |installer|\n${hook}`);
          } else {
            podfile += `\npost_install do |installer|\n${hook}\nend\n`;
          }
          fs.writeFileSync(podfilePath, podfile);
        }
      }

      // Also patch the installed expo-modules-jsi script in node_modules if present
      const jsiScript = path.join(c.modRequest.projectRoot, 'node_modules/expo-modules-jsi/apple/scripts/build-xcframework.sh');
      if (fs.existsSync(jsiScript)) {
        let script = fs.readFileSync(jsiScript, 'utf8');
        // If xcodebuild in build-xcframework.sh fails or doesn't find framework_src, ensure it builds or falls back gracefully
        if (!script.includes('ENABLE_USER_SCRIPT_SANDBOXING=NO')) {
          script = script.replace('xcodebuild \\', 'xcodebuild \\\n    ENABLE_USER_SCRIPT_SANDBOXING=NO \\');
          fs.writeFileSync(jsiScript, script);
        }
      }

      return c;
    },
  ]);

  return config;
};
