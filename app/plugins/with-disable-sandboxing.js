const { withDangerousMod } = require('expo/config-plugins');
const fs = require('fs');
const path = require('path');

module.exports = function withDisableSandboxing(config) {
  return withDangerousMod(config, [
    'ios',
    (c) => {
      const podfilePath = path.join(c.modRequest.platformProjectRoot, 'Podfile');
      if (fs.existsSync(podfilePath)) {
        let podfile = fs.readFileSync(podfilePath, 'utf8');
        const hook = `
    installer.pods_project.targets.each do |target|
      target.build_configurations.each do |config|
        config.build_settings['ENABLE_USER_SCRIPT_SANDBOXING'] = 'NO'
      end
    end
`;
        if (!podfile.includes("ENABLE_USER_SCRIPT_SANDBOXING")) {
          if (podfile.includes("post_install do |installer|")) {
            podfile = podfile.replace("post_install do |installer|", `post_install do |installer|${hook}`);
          } else {
            podfile += `
post_install do |installer|
${hook}
end
`;
          }
          fs.writeFileSync(podfilePath, podfile);
        }
      }
      return c;
    },
  ]);
};
