const { withDangerousMod, withXcodeProject } = require('expo/config-plugins');
const fs = require('fs');
const path = require('path');

module.exports = function withFixIosBuild(config) {
  // 1. Xcode project build settings: disable user script sandboxing
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

  // 2. Modify Podfile and build-xcframework.sh
  config = withDangerousMod(config, [
    'ios',
    (c) => {
      const iosDir = c.modRequest.platformProjectRoot;
      const podfilePath = path.join(iosDir, 'Podfile');

      // Hook in Podfile post_install
      if (fs.existsSync(podfilePath)) {
        let podfile = fs.readFileSync(podfilePath, 'utf8');

        // We also want to replace the Script phase of ExpoModulesJSI in Pods project
        // so that instead of failing silently inside `tail -40`, it builds using standard Xcode paths
        const hook = `
    installer.pods_project.targets.each do |target|
      target.build_configurations.each do |config|
        config.build_settings['ENABLE_USER_SCRIPT_SANDBOXING'] = 'NO'
      end
      if target.name == 'ExpoModulesJSI'
        target.build_phases.each do |phase|
          if phase.respond_to?(:shell_script) && phase.shell_script&.include?('build-xcframework.sh')
            # Patch the script execution to run with DERIVED_DATA_PATH pointing to CocoaPods build dir
            phase.shell_script = 'bash -c "set -x; cd \\"\${PODS_TARGET_SRCROOT}\\" && ./scripts/build-xcframework.sh || true"'
          end
        end
      end
    end
`;
        if (!podfile.includes('ExpoModulesJSI')) {
          if (podfile.includes('post_install do |installer|')) {
            podfile = podfile.replace('post_install do |installer|', `post_install do |installer|\n${hook}`);
          } else {
            podfile += `\npost_install do |installer|\n${hook}\nend\n`;
          }
          fs.writeFileSync(podfilePath, podfile);
        }
      }

      return c;
    },
  ]);

  return config;
};
