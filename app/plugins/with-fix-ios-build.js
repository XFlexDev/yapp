const { withDangerousMod, withXcodeProject } = require('expo/config-plugins');
const fs = require('fs');
const path = require('path');

module.exports = function withFixIosBuild(config) {
  // 1. Disable user script sandboxing in the main Xcode project
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

  // 2. Podfile post_install:
  // - Disable sandboxing across all CocoaPods targets
  // - Ensure ExpoModulesJSI is properly built by its build script for iphoneos
  config = withDangerousMod(config, [
    'ios',
    (c) => {
      const iosDir = c.modRequest.platformProjectRoot;
      const podfilePath = path.join(iosDir, 'Podfile');

      if (fs.existsSync(podfilePath)) {
        let podfile = fs.readFileSync(podfilePath, 'utf8');

        const hook = `
    installer.pods_project.targets.each do |target|
      target.build_configurations.each do |config|
        config.build_settings['ENABLE_USER_SCRIPT_SANDBOXING'] = 'NO'
      end
    end

    # Explicitly invoke ExpoModulesJSI's build-xcframework.sh during pod install
    # so the real arm64 slice is built ahead of time and present before xcodebuild runs.
    jsi_target = installer.pod_targets.find { |t| t.name == 'ExpoModulesJSI' }
    if jsi_target
      pod_dir = jsi_target.sandbox.pod_dir('ExpoModulesJSI')
      build_script = File.join(pod_dir, 'scripts', 'build-xcframework.sh')
      if File.exist?(build_script)
        Pod::UI.puts "[Expo] Pre-building ExpoModulesJSI.xcframework for iphoneos...".green
        system("PLATFORM_NAME=iphoneos bash #{build_script}", chdir: pod_dir.to_s)
      end
    end
`;
        if (!podfile.includes('Pre-building ExpoModulesJSI')) {
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
